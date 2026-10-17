#!/usr/bin/env python3
"""Check zenith-compose.yml against the submission rules we know of.

`docker compose config` only proves the file is valid Compose. Zenith's public docs don't
publish a schema, so these rules come from published Zenith submissions: header comment,
images (no build), no bind mounts / env_file / extends / include, no ${VAR} interpolation,
DNS-safe service names, and an x-zenith block whose expose and storage entries are valid.
"""
from __future__ import annotations

import re
import sys

import yaml

HEADER = "# https://zenith.hosting/developers"
X_FIELDS = {"catalog", "expose", "storage", "configs", "env"}
STORAGE_FIELDS = {"volume", "label", "description", "default_size", "public"}
DNS = re.compile(r"\A[a-z0-9]([a-z0-9-]*[a-z0-9])?\Z")
QTY = re.compile(r"\A[0-9]+(\.[0-9]+)?(Ki|Mi|Gi|Ti|K|M|G|T)?\Z")
INTERP = re.compile(r"\$(?!\$)\{?[A-Za-z_][A-Za-z0-9_]*\}?")


def strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "zenith-compose.yml"
    text = open(path, encoding="utf-8").read()
    errors: list[str] = []
    lines = text.splitlines()
    if not lines or lines[0] != HEADER or (len(lines) > 1 and lines[1].strip()):
        errors.append(f"first line must be '{HEADER}' followed by a blank line")
    doc = yaml.safe_load(text)
    for p, v in strings(doc):
        if INTERP.search(v):
            errors.append(f"unresolved interpolation at {p.lstrip('.')}: use x-zenith.env (or $$ in shell commands)")
    if "include" in doc:
        errors.append("top-level include is not allowed")
    services = doc.get("services") or {}
    volumes = set((doc.get("volumes") or {}).keys())
    for name, svc in services.items():
        if not DNS.match(str(name).replace("_", "-")):
            errors.append(f"service '{name}' is not a DNS label")
        if not svc.get("image"):
            errors.append(f"service '{name}' needs an image (Zenith doesn't build)")
        for bad in ("build", "extends", "env_file"):
            if bad in svc:
                errors.append(f"service '{name}' uses '{bad}'")
        for v in svc.get("volumes") or []:
            src = v.split(":")[0] if isinstance(v, str) else v.get("source")
            if src and ("/" in src or src.startswith((".", "~", "$"))):
                errors.append(f"service '{name}': bind mount '{v}' is not allowed")
            elif src and src not in volumes:
                errors.append(f"service '{name}': volume '{src}' is not declared")
    xz = doc.get("x-zenith") or {}
    if set(xz) - X_FIELDS:
        errors.append(f"unknown x-zenith fields: {sorted(set(xz) - X_FIELDS)}")
    if not str((xz.get("catalog") or {}).get("name") or "").strip():
        errors.append("x-zenith.catalog.name is required")
    expose = xz.get("expose") or []
    if not expose:
        errors.append("at least one x-zenith.expose entry is required")
    for i, e in enumerate(expose):
        if e.get("service") not in services:
            errors.append(f"expose[{i}] points at unknown service")
        if not isinstance(e.get("port"), int):
            errors.append(f"expose[{i}].port must be an integer")
        if not isinstance(e.get("web"), bool):
            errors.append(f"expose[{i}].web must be true or false")
    if sum(1 for e in expose if not e.get("label")) > 1:
        errors.append("only one expose entry may be the unlabelled primary host")
    for key, s in (xz.get("storage") or {}).items():
        if set(s) - STORAGE_FIELDS:
            errors.append(f"storage.{key} has unsupported fields")
        if s.get("volume") not in volumes:
            errors.append(f"storage.{key}.volume is not a declared volume")
        if s.get("default_size") is not None and not QTY.match(str(s["default_size"])):
            errors.append(f"storage.{key}.default_size must look like 5Gi")
    for key, e in (xz.get("env") or {}).items():
        for svc in e.get("services") or []:
            if svc not in services:
                errors.append(f"env.{key} targets unknown service '{svc}'")
        if not ({"alias", "generate", "template", "input"} & set(e)):
            errors.append(f"env.{key} needs alias, generate, template or input")
    for e in errors:
        print(f"check-zenith: {e}", file=sys.stderr)
    if errors:
        return 1
    print(f"check-zenith: {path} ok ({len(services)} services)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
