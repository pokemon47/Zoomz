"""Outgoing email. With no SMTP configured (local development) messages go to the log."""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from html import escape

from .config import settings

log = logging.getLogger("zoomz.mail")


def send(to: str, subject: str, text: str, button: tuple[str, str] | None = None) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    body = text + (f"\n\n{button[0]}: {button[1]}\n" if button else "")
    msg.set_content(body)
    if button:
        label, url = escape(button[0]), escape(button[1], quote=True)
        msg.add_alternative(
            f"""<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:24px;color:#17131F;max-width:480px">
<p>{escape(text).replace(chr(10), '<br>')}</p>
<p><a href="{url}" style="display:inline-block;background:#FF8E72;color:#17131F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">{label}</a></p>
<p style="color:#5E5568;font-size:13px">Or paste this link into your browser:<br>{url}</p></div>""",
            subtype="html",
        )
    if not settings.smtp_host:
        log.warning("SMTP not configured; email to %s — %s\n%s", to, subject, body)
        return
    ctx = ssl.create_default_context()
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=15) as s:
            _login_send(s, msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            if settings.smtp_tls:
                s.starttls(context=ctx)
            _login_send(s, msg)


def _login_send(s: smtplib.SMTP, msg: EmailMessage) -> None:
    if settings.smtp_user:
        s.login(settings.smtp_user, settings.smtp_password or "")
    s.send_message(msg)
