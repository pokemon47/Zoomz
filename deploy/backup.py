"""Paired PostgreSQL/media backup and restore for the standard Compose deployment.

Run on an operator host with Python 3.12+ and Docker Compose. Backup briefly stops
the only app writer. Schedule daily, copy archives off-host, and retain at least 7 days.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEMBERS = {"manifest.json", "database.dump", "uploads.tar"}
NAME = re.compile(r"zoomz-backup-\d{8}T\d{6}Z-[a-z0-9_]+\.tar$")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pack(stage, target):
    manifest = {"version": 1, "created": datetime.now(timezone.utc).isoformat(), "sha256": {n: digest(stage / n) for n in MEMBERS - {"manifest.json"}}}
    (stage / "manifest.json").write_text(json.dumps(manifest))
    with tarfile.open(target, "w") as archive:
        for name in sorted(MEMBERS):
            archive.add(stage / name, arcname=name)


def unpack(source, stage):
    with tarfile.open(source) as archive:
        members = archive.getmembers()
        if len(members) != 3 or {m.name for m in members} != MEMBERS or any(not m.isfile() for m in members):
            raise ValueError("Not a Zoomz paired backup")
        for member in members:
            with archive.extractfile(member) as src, (stage / member.name).open("wb") as dest:
                shutil.copyfileobj(src, dest)
    manifest = json.loads((stage / "manifest.json").read_text())
    if manifest.get("version") != 1 or any(manifest.get("sha256", {}).get(n) != digest(stage / n) for n in MEMBERS - {"manifest.json"}):
        raise ValueError("Backup checksum/version validation failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.production")
    parser.add_argument("--project", default="zoomz")
    sub = parser.add_subparsers(dest="action", required=True)
    backup = sub.add_parser("backup")
    backup.add_argument("directory", type=Path)
    backup.add_argument("--keep-days", type=int, default=7)
    restore = sub.add_parser("restore", help="Restore only trusted archives into an empty recovery project")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--confirm-empty-target", action="store_true", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    compose = ["docker", "compose", "--env-file", str(args.env_file.resolve()), "-p", args.project, "-f", str(ROOT / "compose.production.yml")]

    def run(*command, **kwargs):
        return subprocess.run(compose + list(command), check=True, **kwargs)

    if args.action == "backup":
        directory = args.directory.expanduser().resolve()
        if directory == Path("/") or args.keep_days < 1:
            parser.error("Use a dedicated backup directory and positive retention")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        running = run("ps", "--status", "running", "--services", capture_output=True, text=True).stdout.splitlines()
        was_running = "app" in running
        if was_running:
            run("stop", "app")
        try:
            with tempfile.TemporaryDirectory(prefix=".zoomz-stage-", dir=directory) as tmp:
                stage = Path(tmp)
                with (stage / "database.dump").open("wb") as output:
                    run("exec", "-T", "db", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc', stdout=output)
                with (stage / "uploads.tar").open("wb") as output:
                    run("run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", "app", "-C", "/data/uploads", "-cf", "-", ".", stdout=output)
                target = directory / f"zoomz-backup-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{stage.name.rsplit('-', 1)[-1]}.tar"
                pack(stage, stage / "paired.tar")
                os.replace(stage / "paired.tar", target)
            cutoff = datetime.now(timezone.utc).timestamp() - args.keep_days * 86400
            for old in directory.iterdir():
                if NAME.fullmatch(old.name) and old.is_file() and not old.is_symlink() and old != target and old.stat().st_mtime < cutoff:
                    old.unlink()
            print(target)
        finally:
            if was_running:
                run("start", "app")
    else:
        with tempfile.TemporaryDirectory(prefix="zoomz-restore-") as tmp:
            stage = Path(tmp)
            unpack(args.archive, stage)
            run("stop", "app")
            run("up", "-d", "--wait", "db")
            # Restore refuses a populated database or media volume. It never deletes existing data.
            count = run("exec", "-T", "db", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema=\'public\'"', capture_output=True, text=True).stdout.strip()
            if count != "0":
                raise ValueError("Recovery database is not empty; use a fresh project/volume")
            run("run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "app", "-c", "from pathlib import Path; p=Path('/data/uploads'); assert not any(p.iterdir()), 'Recovery media volume is not empty'")
            with (stage / "database.dump").open("rb") as source:
                run("exec", "-T", "db", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error', stdin=source)
            with (stage / "uploads.tar").open("rb") as source:
                run("run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "app", "-c", "import sys,tarfile; tarfile.open(fileobj=sys.stdin.buffer, mode='r|').extractall('/data/uploads', filter='data')", stdin=source)
        print("Restore complete. Start the recovery project and run acceptance checks before switching traffic.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError, subprocess.CalledProcessError):
        raise SystemExit("Backup/recovery failed. Do not switch traffic; check configuration and target health.") from None
