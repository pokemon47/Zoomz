"""Opt-in provider file transfer, with DNS pinning and no credential forwarding."""
import http.client
import ipaddress
import os
import socket
import ssl
from time import monotonic
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field
from fastapi import HTTPException


class ProviderFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    download_url: str = Field(max_length=8000)
    file_id: str = Field(min_length=1, max_length=200)
    mime_type: str | None = None
    file_name: str | None = Field(default=None, max_length=255)


def destination(value):
    url = urlsplit(value)
    allowed = {host.strip().lower() for host in os.environ.get("MCP_SOURCE_HOSTS", "").split(",") if host.strip()}
    if (url.scheme != "https" or url.port not in {None, 443} or not url.hostname or url.hostname.lower() not in allowed
            or url.username or url.password or url.fragment or any(ord(c) < 33 for c in value)):
        raise HTTPException(400, "Source host is not explicitly enabled for HTTPS transfer; use direct upload")
    addresses = {record[4][0] for record in socket.getaddrinfo(url.hostname, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(value).is_global or ipaddress.ip_address(value).is_multicast for value in addresses):
        raise HTTPException(400, "Source must resolve only to public addresses")
    return url, sorted(addresses)[0]


def download(value):
    try:
        url, address = destination(value)
        connection = http.client.HTTPSConnection(url.hostname, port=443, timeout=20, context=ssl.create_default_context())
        # Keep original Host, TLS SNI, and certificate verification, but never resolve again.
        connection._create_connection = lambda _address, timeout, source_address=None: socket.create_connection((address, 443), timeout, source_address)
        try:
            deadline = monotonic() + 20
            target = (url.path or "/") + ("?" + url.query if url.query else "")
            connection.request("GET", target, headers={"Accept": "*/*"})
            transport = connection.sock
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise TimeoutError()
            if transport:
                transport.settimeout(remaining)
            response = connection.getresponse()
            if response.status != 200:
                raise HTTPException(400, "Source could not be fetched; redirects are not followed")
            length = response.getheader("Content-Length")
            maximum = 25 * 1024 * 1024
            if length and int(length) > maximum:
                raise HTTPException(413, "Source exceeds the 25 MiB transfer limit")
            payload = bytearray()
            while True:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                if transport:
                    transport.settimeout(remaining)
                chunk = response.read1(min(65536, maximum + 1 - len(payload)))
                if not chunk:
                    return bytes(payload)
                payload.extend(chunk)
                if len(payload) > maximum:
                    raise HTTPException(413, "Source exceeds the 25 MiB transfer limit")
        finally:
            connection.close()
    except (OSError, ValueError, http.client.HTTPException):
        raise HTTPException(400, "Source transfer failed; use direct upload") from None
