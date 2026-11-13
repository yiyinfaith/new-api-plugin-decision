"""End-to-end test against a real, isolated New API instance (stdlib only).

Never point this at a production gateway: it creates channels, prices and
tokens. Start a throwaway instance and the mock upstream first, e.g.

    docker run -d --name decision-test --network host -e PORT=49300 \
        -v /tmp/decision-test:/data calciumion/new-api:latest
    node tests/mock-upstream.mjs 49311 &
    NA_BASE=http://127.0.0.1:49300 MOCK=http://127.0.0.1:49311 \
        python3 tests/e2e/e2e.py plugin.js [typesafe-plugin.js]

The first run creates the root user from NA_USER / NA_PASS. Exit status is the
number of failed checks.
"""
import base64, hashlib, json, os, sys, time, urllib.error, urllib.request, uuid

BASE = os.environ.get("NA_BASE", "http://127.0.0.1:49300")
MOCK = os.environ.get("MOCK", "http://127.0.0.1:49311")
USER = os.environ.get("NA_USER", "root")
PASS = os.environ.get("NA_PASS", "DecisionTest-2026!")
QUOTA_PER_USD = 500000
FAILED = []


def http(method, url, body=None, headers=None, data=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    if data is None and body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


class Admin:
    def __init__(self):
        status = self.api("GET", "/api/setup", ok=False, auth=False)
        if not (status.get("data") or {}).get("status"):
            self.api("POST", "/api/setup", {"username": USER, "password": PASS, "confirmPassword": PASS, "SelfUseModeEnabled": False, "DemoSiteEnabled": False}, auth=False)
        login = self.api("POST", "/api/user/login", {"username": USER, "password": PASS}, auth=False)["data"]
        self.headers = {"Authorization": "Bearer " + login["access_token"], "New-Api-User": str(login["user"]["id"])}

    def api(self, method, path, body=None, ok=True, auth=True):
        status, text = http(method, BASE + path, body, self.headers if auth else None)
        try:
            value = json.loads(text)
        except ValueError:
            value = {"raw": text}
        if ok and (status >= 400 or (isinstance(value, dict) and value.get("success") is False)):
            raise RuntimeError(f"{method} {path} -> {status} {text[:600]}")
        return value

    def option(self, key, value):
        self.api("PUT", "/api/option/", {"key": key, "value": value if isinstance(value, str) else json.dumps(value)})

    def install(self, source):
        meta_key = source.split('key: "', 1)[1].split('"', 1)[0]
        version = source.split('version: "', 1)[1].split('"', 1)[0] if 'const VERSION = "' not in source else source.split('const VERSION = "', 1)[1].split('"', 1)[0]
        listed = self.api("GET", "/api/plugin/task")["data"]
        items = listed if isinstance(listed, list) else listed.get("items", [])
        stored = [v.get("version") for p in items if (p.get("meta") or {}).get("key") == meta_key for v in (p.get("versions") or [])]
        if version not in stored:
            self.api("POST", "/api/plugin/task", {"source": source, "sourceSha256": hashlib.sha256(source.encode()).hexdigest(), "enabled": True, "remark": "e2e"})
        self.api("POST", f"/api/plugin/task/{meta_key}/activate", {"version": version})
        return meta_key, version

    def channels(self):
        value = self.api("GET", "/api/channel/?p=0&page_size=200")["data"]
        return value["items"] if isinstance(value, dict) else value

    def channel(self, channel):
        for existing in self.channels():
            if existing["name"] == channel["name"]:
                self.api("DELETE", f"/api/channel/{existing['id']}")
        self.api("POST", "/api/channel/", {"mode": "single", "channel": channel})
        return max(c["id"] for c in self.channels() if c["name"] == channel["name"])

    def token(self, name):
        self.api("POST", "/api/token/", {"name": name, "remain_quota": 0, "unlimited_quota": True, "expired_time": -1})
        value = self.api("GET", "/api/token/?p=0&size=100")["data"]
        items = value["items"] if isinstance(value, dict) else value
        token_id = max(i["id"] for i in items if i["name"] == name)
        key = self.api("POST", f"/api/token/{token_id}/key")["data"]["key"]
        return key if key.startswith("sk-") else "sk-" + key

    def last_log(self):
        value = self.api("GET", "/api/log/?p=0&page_size=5&type=2")["data"]
        items = value["items"] if isinstance(value, dict) else value
        return items[0] if items else None


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:900]))
    if not condition:
        FAILED.append(name)


def call(token, path, body, headers=None, data=None, content_type=None):
    h = {"Authorization": "Bearer " + token}
    if content_type:
        h["Content-Type"] = content_type
    h.update(headers or {})
    status, text = http("POST", BASE + path, body, h, data)
    try:
        return status, json.loads(text)
    except ValueError:
        return status, {"raw": text}


def received():
    return json.loads(http("GET", MOCK + "/__received")[1])


TEXT = "The package arrived crushed and the mug inside is broken."
LEVELS = ["Minor", "Moderate", "Severe"]


def body_for(client, model):
    if client == "systemone":
        return {"model": model, "state": {"ticket": TEXT, "channel": "email"}, "questions": {
            "wants_refund": {"type": "noul", "instructions": "Does the customer want a refund?"},
            "request": {"type": "choice", "criteria": {"refund": "Wants the money back", "replacement": "Wants a new mug", "other": None}},
            "severity": {"type": "score", "criteria": LEVELS}}}
    if client == "openai":
        return {"model": model, "input": TEXT, "questions": [
            {"type": "predicate", "name": "wants_refund", "instructions": "Does the customer want a refund?"},
            {"type": "choice", "name": "request", "instructions": "What does the customer want?", "choices": [{"value": "refund"}, {"value": "replacement"}, {"value": "other"}]},
            {"type": "score", "name": "severity", "instructions": "How severe?", "levels": [{"label": l} for l in LEVELS]}]}
    if client == "gemini":
        return {"model": model, "input": TEXT, "questions": {
            "wants_refund": {"type": "noul", "instructions": "Does the customer want a refund?"},
            "request": {"type": "choice", "instructions": "What does the customer want?", "criteria": {"refund": "Money back", "replacement": "New mug"}},
            "severity": {"type": "score", "instructions": "How severe?", "criteria": LEVELS}}}
    if client == "vercel":
        return {"model": model, "state": TEXT, "questions": {
            "wants_refund": {"type": "boolean", "instructions": "Does the customer want a refund?"},
            "request": {"type": "choice", "criteria": {"refund": "Money back", "replacement": "New mug"}},
            "severity": {"type": "score", "criteria": LEVELS}}}
    if client == "databricks":
        return {"model": model, "state": {"ticket": TEXT}, "questions": {
            "wants_refund": {"type": "noul", "instructions": "Does the customer want a refund?"},
            "request": {"type": "choice", "instructions": "What does the customer want?", "criteria": {"refund": "Money back", "replacement": "New mug", "other": None}},
            "severity": {"type": "score", "instructions": "How severe?", "criteria": LEVELS}}, "options": {"version": "1.0"}}
    raise ValueError(client)


PATHS = {"systemone": "/v1/systemone", "openai": "/v1/decisions", "gemini": "/v1beta/decisions", "vercel": "/v1/evaluate", "databricks": "/api/2.0/ai-functions/ai-decide"}


def shape_ok(client, reply):
    if client == "databricks":
        a = (reply.get("response") or {}).get("answers") or {}
        return sorted(a.keys()) == ["request", "severity", "wants_refund"] and a["wants_refund"] == {"type": "noul", "probability": 0.8} \
            and a["request"]["choice"] == "refund" and reply.get("metadata") == {"version": "1.0"} and "usage" not in reply
    if client == "openai":
        a = reply.get("answers")
        return isinstance(a, list) and a[0]["type"] == "predicate" and a[1]["choice"] == "refund" and a[2]["type"] == "score" and "input_tokens" in reply["usage"]
    a = reply.get("answers") or {}
    # Keyed answers: the host writes presenter objects with sorted keys.
    if sorted(a.keys()) != ["request", "severity", "wants_refund"]:
        return False
    if client == "gemini":
        return a["wants_refund"]["noul"] == 0.8 and "total_input_tokens" in reply["usage"]
    if client == "vercel":
        return a["wants_refund"] == {"type": "boolean", "probability": 0.8} and "inputTokens" in reply["usage"]
    return a["wants_refund"]["noul"] == 0.8 and a["request"]["choice"] == "refund" and "input_tokens" in reply["usage"]


def reply_usage(client, reply):
    u = reply["usage"]
    if client == "openai":
        d = u.get("input_tokens_details") or {}
        return u["input_tokens"], d.get("cached_tokens", 0), d.get("cache_write_tokens", 0)
    if client == "gemini":
        return u["total_input_tokens"], u.get("total_cached_tokens", 0), 0
    if client == "vercel":
        return u["inputTokens"], 0, 0
    return u["input_tokens"], (u.get("input_tokens_details") or {}).get("cached_tokens", 0), 0


PRICES = {"jev": 0.042, "gemini": 0.10, "custom": 1.0}


def upstream_usage(model):
    """The usage the mock reported for its last request (see mock-upstream.mjs)."""
    sent = received()[-1]
    n = max(1, -(-len(json.dumps(sent["body"], separators=(",", ":"), ensure_ascii=False)) // 4))
    if model == "gpt-6-luna":
        return n, n // 4, n // 8
    if model == "gemini-decision-1":
        return n, 2, 0
    return n, 0, 0


def expected_quota(model, total, cached, written):
    if model == "gpt-6-luna":
        usd = ((total - cached - written) * 0.10 + cached * 0.01 + written * 0.125) / 1e6
    elif model == "gemini-decision-1":
        usd = ((total - cached) * 0.10 + cached * 0.01) / 1e6
    elif model.startswith("jev"):
        usd = (total - cached) * 0.042 / 1e6
    else:
        usd = (total - cached) * 1.0 / 1e6
    return round(usd * QUOTA_PER_USD)


def set_task_prices(admin, exprs):
    """Model-level task expressions; modes are dropped first so the expression map can shrink."""
    admin.option("billing_setting.billing_mode", {})
    admin.option("billing_setting.billing_expr", exprs)
    admin.option("billing_setting.billing_mode", {m: "tiered_expr" for m in exprs})


def last_received():
    items = received()
    return json.dumps(items[-1], sort_keys=True) if items else ""


def main():
    plugin_source = open(sys.argv[1], encoding="utf-8").read()
    admin = Admin()
    key, version = admin.install(plugin_source)
    print("installed", key, version)
    if len(sys.argv) > 2:
        print("installed", *admin.install(open(sys.argv[2], encoding="utf-8").read()))
    time.sleep(2)

    s1 = admin.channel({"name": "e2e-systemone", "type": 61, "key": "upstream-key-s1", "base_url": MOCK, "status": 1, "priority": 10,
                        "models": "jev-latest,jev-1.14.0,jev-preview,jev,liquid/d1,ratio-model",
                        "model_mapping": json.dumps({"liquid/d1": "decision-custom", "ratio-model": "decision-custom", "jev-preview": "fail-401", "jev": "missing-usage"}),
                        "setting": json.dumps({"task_plugin_key": "decision"}), "settings": json.dumps({"plugin_config": {"protocol": "systemone"}})})
    oa = admin.channel({"name": "e2e-openai", "type": 61, "key": "upstream-key-oa", "base_url": MOCK, "status": 1, "priority": 10, "models": "gpt-6-luna",
                        "setting": json.dumps({"task_plugin_key": "decision"}), "settings": json.dumps({"plugin_config": {"protocol": "openai"}})})
    gm = admin.channel({"name": "e2e-gemini", "type": 61, "key": "upstream-key-gm", "base_url": MOCK, "status": 1, "priority": 10, "models": "gemini-decision-1",
                        "setting": json.dumps({"task_plugin_key": "decision"}), "settings": json.dumps({"plugin_config": {"protocol": "gemini"}})})
    dbx = admin.channel({"name": "e2e-databricks", "type": 61, "key": "upstream-key-dbx", "base_url": MOCK, "status": 1, "priority": 10,
                         "models": "databricks-decide,dbx-expr,dbx-tokens,dbx-fail",
                         "model_mapping": json.dumps({m: "decision-custom" for m in ["databricks-decide", "dbx-expr", "dbx-tokens", "dbx-fail"]}),
                         "setting": json.dumps({"task_plugin_key": "decision"}),
                         "settings": json.dumps({"plugin_config": {"protocol": "databricks", "modelPaths": {"dbx-fail": "/api/2.0/ai-functions/ai-decide?fail=403"}}})})
    admin.channel({"name": "e2e-chat", "type": 1, "key": "upstream-key-chat", "base_url": MOCK, "status": 1, "models": "gpt-6-luna"})
    if len(sys.argv) > 2:
        admin.channel({"name": "e2e-typesafe", "type": 61, "key": "upstream-key-ts", "base_url": MOCK, "status": 1, "models": "jev-1.13.0",
                       "setting": json.dumps({"task_plugin_key": "typesafe"})})
    print("channels", s1, oa, gm, dbx)

    jev = 'tier("base", u("input_tokens") * 0.042 / 1000000)'
    admin.option("ModelRatio", {"gpt-6-luna": 0.05, "ratio-model": 0.021})
    admin.option("ModelPrice", {"databricks-decide": 0.002, "dbx-fail": 0.002})
    admin.option("CompletionRatio", {"gpt-6-luna": 5})
    admin.option("CacheRatio", {"gpt-6-luna": 0.1})
    exprs = {m: jev for m in ["jev-latest", "jev-1.14.0", "jev-preview", "jev", "jev-1.13.0"]}
    exprs["gemini-decision-1"] = 'tier("base", u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.01 / 1000000)'
    exprs["decision-custom"] = 'tier("base", u("input_tokens") * 1 / 1000000)'
    set_task_prices(admin, exprs)
    luna = 'u("long_context") ? tier("long", (u("input_tokens") * 0.20 + u("cache_read_tokens") * 0.02 + u("cache_write_tokens") * 0.25) / 1000000) : tier("base", (u("input_tokens") * 0.10 + u("cache_read_tokens") * 0.01 + u("cache_write_tokens") * 0.125) / 1000000)'
    admin.option("billing_setting.plugin_billing_expr", {"decision::gpt-6-luna": luna})
    token = admin.token("e2e-" + uuid.uuid4().hex[:6])
    time.sleep(3)

    # 1. Core 3 x 3 plus the evaluation client, with settlement checked in the log.
    for client in ["systemone", "openai", "gemini", "vercel"]:
        for model in ["jev-latest", "gpt-6-luna", "gemini-decision-1"]:
            status, reply = call(token, PATHS[client], body_for(client, model))
            name = f"{client} client -> {model}"
            check(name + " answers", status == 200 and shape_ok(client, reply), (status, reply))
            if status == 200:
                total, cached, written = upstream_usage(model)
                time.sleep(0.6)
                log = admin.last_log()
                want = expected_quota(model, total, cached, written)
                check(name + " billing", log and log["model_name"] == model and abs(log["quota"] - want) <= 1, (want, log and log["quota"], log and log.get("content")))

    # 2. Plugin prefix and other client paths.
    for path, client, model in [("/decision/v1/decisions", "openai", "jev-latest"), ("/decision/v1beta/decisions", "gemini", "gpt-6-luna"), ("/decision/v1/systemone", "systemone", "gemini-decision-1"),
                                ("/api/alpha/decisions", "systemone", "jev-latest"), ("/decision/api/v1/systemone", "systemone", "jev-latest"),
                                ("/openai/v1/decisions", "openai", "jev-latest"), ("/v1/decisions", "systemone", "gpt-6-luna"), ("/decision/v1/evaluate", "vercel", "gemini-decision-1")]:
        status, reply = call(token, path, body_for(client, model))
        check(f"{path} ({client} body, {model})", status == 200 and shape_ok(client, reply), (status, reply))

    # 3. Any model name through decision-custom; the client's name goes upstream.
    status, reply = call(token, "/v1/decisions", body_for("openai", "liquid/d1"))
    sent = received()[-1]
    check("custom model liquid/d1", status == 200 and sent["body"]["model"] == "liquid/d1", (status, reply, sent.get("body", {}).get("model")))
    usage = upstream_usage("liquid/d1")
    time.sleep(0.6)
    log = admin.last_log()
    check("custom model billed by its slot price", log and log["model_name"] == "liquid/d1" and log["quota"] == expected_quota("liquid/d1", *usage), (expected_quota("liquid/d1", *usage), log))
    status, reply = call(token, "/v1/decisions", body_for("openai", "not-a-declared-model"))
    check("undeclared model is refused by the host", status in (400, 404, 503) and "not-a-declared-model" in json.dumps(reply), (status, reply))

    # 4. Errors in each client's format, without a charge.
    before = admin.last_log()
    status, reply = call(token, "/v1/systemone", body_for("systemone", "jev-preview"))
    check("upstream 401 in TypeSafe format", status == 401 and reply == {"detail": "mock 401"}, (status, reply))
    status, reply = call(token, "/v1/decisions", body_for("openai", "jev-preview"))
    check("upstream 401 in OpenAI format", status == 401 and reply.get("error", {}).get("message") == "mock 401", (status, reply))
    status, reply = call(token, "/v1beta/decisions", dict(body_for("gemini", "gemini-decision-1"), extra=1))
    check("invalid request in Gemini format", status == 400 and reply.get("error", {}).get("status") == "INVALID_ARGUMENT", (status, reply))
    time.sleep(0.6)
    after = admin.last_log()
    check("failed requests are not charged", (after or {}).get("id") == (before or {}).get("id"), (before and before.get("id"), after and after.get("id")))

    # 5. Missing usage keeps the reservation.
    status, reply = call(token, "/v1/systemone", body_for("systemone", "jev"))
    time.sleep(0.6)
    log = admin.last_log()
    check("missing usage: answered and charged the reservation", status == 200 and log and log["model_name"] == "jev" and log["quota"] > 0, (status, log))

    # 6. Multipart upload, passed through to System One and converted for OpenAI.
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==")
    for model, upstream_check in [("jev-latest", "parts"), ("gpt-6-luna", "dataurl")]:
        boundary = "----decision" + uuid.uuid4().hex
        request = {"model": model, "state": "Look at img-1", "questions": {"cat": {"type": "noul", "instructions": "Is there a cat?"}}, "assets": {"img-1": {"type": "image", "part": "photo"}}}
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n{json.dumps(request)}\r\n'.encode(),
                 f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="cat.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + png + b"\r\n",
                 f"--{boundary}--\r\n".encode()]
        status, reply = call(token, "/v1/systemone", None, data=b"".join(parts), content_type="multipart/form-data; boundary=" + boundary)
        sent = received()[-1]
        if upstream_check == "parts":
            ok = status == 200 and "photo" in (sent.get("parts") or {}) and sent["headers"].get("typesafe-danger-zone-images") == "true"
        else:
            content = sent["body"]["input"][0]["content"]
            ok = status == 200 and any(p.get("type") == "input_image" and p["image_url"].startswith("data:image/png;base64,") for p in content)
        check(f"multipart image -> {model}", ok, (status, reply, {k: sent.get(k) for k in ("path", "parts")}))

    # 7. Long-context header reaches System One.
    status, reply = call(token, "/v1/systemone", body_for("systemone", "jev-latest"), {"TypeSafe-Danger-Zone-Long-Context": "true"})
    check("long-context header forwarded", status == 200 and received()[-1]["headers"].get("typesafe-danger-zone-long-context") == "true")

    # 8. Same model, ordinary chat: billed by the model ratio, unaffected by the plugin.
    status, reply = call(token, "/v1/chat/completions", {"model": "gpt-6-luna", "messages": [{"role": "user", "content": "hi"}]})
    time.sleep(0.6)
    log = admin.last_log()
    # (800 uncached + 200 cached * 0.1) * 0.05 ratio + 100 * 0.05 * 5 completion = 66 quota at ratio 1 = $2 / 1M
    check("gpt-6-luna chat billed as chat", status == 200 and log and log["model_name"] == "gpt-6-luna" and log["quota"] == 66, (status, log and log["quota"]))

    # 9. Coexistence: a model only the TypeSafe channel lists goes to the TypeSafe plugin.
    if len(sys.argv) > 2:
        status, reply = call(token, "/v1/systemone", body_for("systemone", "jev-1.13.0"))
        time.sleep(0.6)
        log = admin.last_log()
        status2, _ = call(token, "/typesafe/v1/systemone", body_for("systemone", "jev-latest"))
        check("/typesafe/ prefix belongs to the TypeSafe plugin while it is installed", status2 == 503, status2)
        check("TypeSafe plugin keeps its own channels", status == 200 and log and '"key":"typesafe"' in (log.get("other") or "").replace(" ", ""), (status, reply, log and log.get("other", "")[:300]))

    # 10. Databricks ai-decide. Without an expression of its own a custom name
    # takes the expression of the slot it maps to, so the slot's is removed here.
    exprs.pop("decision-custom")
    exprs["dbx-expr"] = 'tier("base", u("requests") * 0.003)'
    exprs["dbx-tokens"] = jev
    set_task_prices(admin, exprs)
    time.sleep(3)
    for path in ["/api/2.0/ai-functions/ai-decide", "/decision/api/2.0/ai-functions/ai-decide"]:
        status, reply = call(token, path, body_for("databricks", "jev-latest"))
        check(f"{path}: Databricks client -> System One", status == 200 and shape_ok("databricks", reply), (status, reply))
    total, cached, written = upstream_usage("jev-latest")
    time.sleep(0.6)
    log = admin.last_log()
    check("Databricks client on a token upstream is billed by tokens", log and log["model_name"] == "jev-latest" and abs(log["quota"] - expected_quota("jev-latest", total, cached, written)) <= 1, log)

    status, reply = call(token, "/v1/decisions", body_for("openai", "databricks-decide"))
    sent = received()[-1]
    check("OpenAI client -> ai-decide upstream", status == 200 and shape_ok("openai", {**reply, "usage": {"input_tokens": 0}}) and reply["usage"]["input_tokens"] == 0, (status, reply))
    check("ai-decide request: documented path, no model", sent["path"] == "/api/2.0/ai-functions/ai-decide" and "model" not in sent["body"] and sent["headers"].get("authorization") == "Bearer upstream-key-dbx", {k: sent.get(k) for k in ("path", "body")})
    time.sleep(0.6)
    log = admin.last_log()
    check("ai-decide with a fixed per-call model price: charged that price", log and log["model_name"] == "databricks-decide" and log["quota"] == round(0.002 * QUOTA_PER_USD), log)

    status, reply = call(token, "/api/2.0/ai-functions/ai-decide", body_for("databricks", "dbx-expr"))
    time.sleep(0.6)
    log = admin.last_log()
    check("ai-decide with a per-request task expression: charged u(requests)", status == 200 and shape_ok("databricks", reply) and log and log["model_name"] == "dbx-expr" and log["quota"] == round(0.003 * QUOTA_PER_USD), (status, log))

    before, mark = admin.last_log(), last_received()
    status, reply = call(token, "/api/2.0/ai-functions/ai-decide", body_for("databricks", "dbx-tokens"))
    check("ai-decide under a token expression is refused, not billed as free", status == 400 and last_received() == mark, (status, reply))
    status, reply = call(token, "/api/2.0/ai-functions/ai-decide", body_for("databricks", "dbx-fail"))
    check("ai-decide upstream error in Databricks format", status == 403 and reply == {"error_code": "PERMISSION_DENIED", "message": "mock 403"}, (status, reply))

    # 11. Ratio pricing: the host charges task requests a flat half of the ratio,
    # so the plugin refuses it before anything is sent or charged.
    mark = last_received()
    status, reply = call(token, "/v1/systemone", body_for("systemone", "ratio-model"))
    # New API replaces the plugin's explanation with a generic message here.
    check("ratio-priced decision model is refused before the upstream", status == 400 and reply == {"detail": "plugin usage hook failed"} and last_received() == mark, (status, reply))
    time.sleep(0.6)
    after = admin.last_log()
    check("refused requests are not charged", (after or {}).get("id") == (before or {}).get("id"), (before and before.get("id"), after and after.get("id")))

    print(f"\n{len(FAILED)} failed")
    for name in FAILED:
        print("  -", name)
    return len(FAILED)


if __name__ == "__main__":
    sys.exit(main())
