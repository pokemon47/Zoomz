"""Fail before migrations/server startup when persistent media is not writable."""

from pathlib import Path
from tempfile import TemporaryFile

from .config import settings


def check_storage(path: Path, require_mount: bool = False) -> None:
    try:
        if require_mount:
            location = path.resolve()
            if not any(p != Path("/") and p.is_mount() for p in (location, *location.parents)):
                raise RuntimeError("STORAGE_DIR must be on a persistent volume mount, not the container filesystem")
        path.mkdir(parents=True, exist_ok=True)
        with TemporaryFile(dir=path) as probe:
            probe.write(b"zoomz-storage-check")
            probe.flush()
    except OSError:
        raise RuntimeError("STORAGE_DIR must be a writable persistent media directory") from None


if __name__ == "__main__":
    check_storage(settings.storage_dir, require_mount=not settings.dev)
