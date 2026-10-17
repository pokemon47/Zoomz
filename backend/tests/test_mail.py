import smtplib
from dataclasses import replace
from unittest.mock import MagicMock

import pytest

from app import config, mail


@pytest.fixture
def smtp(monkeypatch):
    settings = replace(config.settings, smtp_host="instance.smtp.test", smtp_user="smtp-user", smtp_password="smtp-secret", smtp_from="sender@example.com")
    monkeypatch.setattr(mail, "settings", settings)
    server = MagicMock()
    server.__enter__.return_value = server
    server.send_message.return_value = {}
    monkeypatch.setattr(mail.smtplib, "SMTP", MagicMock(return_value=server))
    return server


def test_smtp_delivery(smtp):
    mail.send("person@example.com", "Sign in", "Use your link", ("Sign in", "https://zoomz.example/api/auth/verify?token=private-token"))
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("smtp-user", "smtp-secret")
    message = smtp.send_message.call_args.args[0]
    assert message["From"] == "sender@example.com"
    assert "https://zoomz.example/api/auth/verify?token=private-token" in message.get_body(preferencelist=("plain",)).get_content()


def test_rejected_recipient_is_not_success(smtp):
    smtp.send_message.return_value = {"person@example.com": (550, b"refused")}
    with pytest.raises(mail.DeliveryError):
        mail.send("person@example.com", "Invite", "Join us")


@pytest.mark.parametrize("failure", [OSError("smtp-secret"), smtplib.SMTPAuthenticationError(535, b"smtp-secret"), smtplib.SMTPDataError(550, b"smtp-secret")])
def test_delivery_failure_is_safe(smtp, failure, caplog):
    smtp.send_message.side_effect = failure
    with pytest.raises(mail.DeliveryError) as exc:
        mail.send("person@example.com", "Sign in", "token=private-token")
    assert "smtp-secret" not in str(exc.value) + caplog.text
    assert "private-token" not in caplog.text


def test_development_does_not_log_tokens(monkeypatch, caplog):
    monkeypatch.setattr(mail, "settings", replace(config.settings, smtp_host=None))
    mail.send("person@example.com", "Sign in", "token=private-token")
    assert "private-token" not in caplog.text
    assert "person@example.com" not in caplog.text


def test_connection_failure_is_safe(smtp, monkeypatch, caplog):
    monkeypatch.setattr(mail.smtplib, "SMTP", MagicMock(side_effect=OSError("smtp-secret")))
    with pytest.raises(mail.DeliveryError):
        mail.send("person@example.com", "Sign in", "token=private-token")
    assert "smtp-secret" not in caplog.text and "private-token" not in caplog.text


@pytest.mark.parametrize("mode", ["tls", "none"])
def test_other_encryption_modes(smtp, monkeypatch, mode):
    monkeypatch.setattr(mail, "settings", replace(mail.settings, smtp_encryption=mode, smtp_from_name="Zoomz Studio"))
    factory = MagicMock(return_value=smtp)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL" if mode == "tls" else "SMTP", factory)
    mail.send("person@example.com", "Invite", "Welcome")
    factory.assert_called_once()
    smtp.starttls.assert_not_called()
    assert smtp.send_message.call_args.args[0]["From"] == "Zoomz Studio <sender@example.com>"


def production_env(monkeypatch):
    for key, value in {
        "APP_ENV": "production", "PUBLIC_URL": "https://zoomz.example", "SECRET_KEY": "x" * 40,
        "DATABASE_URL": "postgresql+psycopg://zoomz:password@db/zoomz", "STORAGE_DIR": "/data/uploads",
        "SMTP_HOST": "instance.smtp.test", "SMTP_FROM": "sender@example.com", "SMTP_ENCRYPTION": "starttls",
    }.items():
        monkeypatch.setenv(key, value)


def test_missing_production_smtp_is_rejected(monkeypatch):
    production_env(monkeypatch)
    monkeypatch.delenv("SMTP_HOST")
    with pytest.raises(RuntimeError, match="SMTP_HOST"):
        config.load_settings()


@pytest.mark.parametrize("key,value", [("APP_ENV", "prodution"), ("PUBLIC_URL", "http://zoomz.example"), ("DATABASE_URL", "sqlite:///demo.db"), ("SMTP_HOST", "https://smtp.example"), ("SMTP_ENCRYPTION", "bogus"), ("SMTP_PORT", "invalid"), ("SMTP_TIMEOUT", "0"), ("SMTP_FROM", "no-reply@localhost")])
def test_invalid_production_config_is_rejected(monkeypatch, key, value):
    production_env(monkeypatch)
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=key):
        config.load_settings()


def test_valid_production_config_and_secret_repr(monkeypatch):
    production_env(monkeypatch)
    monkeypatch.setenv("SMTP_PASSWORD", "smtp-secret")
    monkeypatch.setenv("SMTP_USER", "user")
    settings = config.load_settings()
    assert settings.secure_cookies and not settings.dev
    assert "smtp-secret" not in repr(settings)
    assert "password@db" not in repr(settings)


def test_magic_and_invitation_use_smtp(make_client, smtp, monkeypatch):
    owner = make_client("mail-owner@example.com")
    from app import auth, spaces
    production = replace(mail.settings, env="production", public_url="https://zoomz.example")
    monkeypatch.setattr(auth, "settings", production)
    monkeypatch.setattr(spaces, "settings", production)
    response = owner.post("/api/auth/magic-link", json={"email": "new@example.com"}, headers={"X-Zoomz": "1"})
    assert response.status_code == 200 and response.json() == {"sent": True}
    body = smtp.send_message.call_args.args[0].get_body(preferencelist=("plain",)).get_content()
    assert "https://zoomz.example/signin/" in body
    token = body.split("/signin/")[1].split()[0].strip()
    visitor = make_client()
    verified = visitor.post("/api/auth/verify", json={"token": token}, headers={"X-Zoomz": "1"})
    assert "Secure" in verified.headers["set-cookie"] and "HttpOnly" in verified.headers["set-cookie"]
    assert "SameSite=lax" in verified.headers["set-cookie"]
    sid = owner.get("/api/spaces").json()["mine"][0]["id"]
    response = owner.post(f"/api/spaces/{sid}/invites", json={"email": "invitee@example.com"}, headers={"X-Zoomz": "1"})
    assert response.status_code == 200 and "devLink" not in response.json()
    assert "https://zoomz.example/invite/" in smtp.send_message.call_args.args[0].get_body(preferencelist=("plain",)).get_content()
    smtp.send_message.side_effect = OSError("smtp-secret")
    failed = owner.post("/api/auth/magic-link", json={"email": "new@example.com"}, headers={"X-Zoomz": "1"})
    assert failed.status_code == 503 and "smtp-secret" not in failed.text
    failed = owner.post(f"/api/spaces/{sid}/invites", json={"email": "invitee@example.com"}, headers={"X-Zoomz": "1"})
    assert failed.status_code == 503 and "smtp-secret" not in failed.text


def test_workspace_invitation_uses_same_sender(make_client, smtp):
    owner = make_client("team-mail@example.com")
    headers = {"X-Zoomz": "1"}
    wid = owner.post("/api/workspaces", json={"name": "Studio"}, headers=headers).json()["id"]
    response = owner.post(f"/api/workspaces/{wid}/members", json={"email": "team-member@example.com"}, headers=headers)
    assert response.status_code == 200
    assert "Open Zoomz" in smtp.send_message.call_args.args[0].get_body(preferencelist=("plain",)).get_content()
    smtp.send_message.side_effect = OSError("smtp-secret")
    failed = owner.post(f"/api/workspaces/{wid}/members", json={"email": "not-added@example.com"}, headers=headers)
    assert failed.status_code == 503
    assert all(m["email"] != "not-added@example.com" for m in owner.get(f"/api/workspaces/{wid}/members").json())
