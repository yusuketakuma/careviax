"""Browser Harness smoke for patient-detail information continuity.

Run with:
  BROWSER_HARNESS_BASE_URL=http://localhost:3012 \
    browser-harness < tools/browser-harness/patient-detail-smoke.py

This file is intentionally plain Python because browser-harness preloads
helpers.py into stdin scripts.
"""

import json
import os
from urllib.parse import urljoin


BASE_URL = os.environ.get("BROWSER_HARNESS_BASE_URL", "http://localhost:3012").rstrip("/")
PATIENT_PATH = os.environ.get("BROWSER_HARNESS_PATIENT_PATH", "/patients")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def visible_snapshot():
    return js(
        """
(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0;
  };
  const text = document.body?.innerText ?? '';
  const patientLinks = Array.from(document.querySelectorAll('main a[href^="/patients/"]'))
    .filter(visible)
    .map((link) => ({
      text: link.innerText.trim(),
      href: link.getAttribute('href'),
    }))
    .filter((link) => link.href && !link.href.endsWith('/new'));
  return {
    url: location.href,
    title: document.title,
    text,
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    patientLinks,
  };
})()
"""
    )


def open_url(path):
    new_tab(urljoin(f"{BASE_URL}/", path.lstrip("/")))
    wait_for_load()
    wait(0.8)
    return visible_snapshot()


list_snapshot = open_url(PATIENT_PATH)
assert_true("/login" not in list_snapshot["url"], "認証画面にリダイレクトされました。実Chromeでログインしてから再実行してください。")
assert_true("患者一覧" in list_snapshot["text"], "患者一覧が表示されていません。")
assert_true(
    list_snapshot["scrollWidth"] <= list_snapshot["width"] + 1,
    "患者一覧で横スクロールが発生しています。",
)
assert_true(list_snapshot["patientLinks"], "患者詳細へのリンクが見つかりません。")

patient_href = list_snapshot["patientLinks"][0]["href"]
detail_snapshot = open_url(patient_href)
assert_true("患者詳細" in detail_snapshot["text"], "患者詳細見出しが表示されていません。")
for label in ["基本情報", "ケース", "処方履歴", "薬剤", "訪問", "連携", "文書", "タイムライン"]:
    assert_true(label in detail_snapshot["text"], f"患者詳細タブ「{label}」が表示されていません。")
assert_true(
    detail_snapshot["scrollWidth"] <= detail_snapshot["width"] + 1,
    "患者詳細で横スクロールが発生しています。",
)

continuity_paths = [
    (f"{patient_href}?tab=prescriptions", "処方履歴"),
    (f"{patient_href}?tab=medications", "薬剤"),
    (f"{patient_href}?tab=visits", "訪問"),
    (f"{patient_href}?tab=communications", "連携"),
    (f"{patient_href}/prescriptions", "処方内容一覧"),
    (f"{patient_href}/medications", "服薬管理"),
    (f"{patient_href}/share", "外部共有"),
]

results = []
for path, expected_text in continuity_paths:
    snapshot = open_url(path)
    ok = expected_text in snapshot["text"] and snapshot["scrollWidth"] <= snapshot["width"] + 1
    results.append(
        {
            "path": path,
            "expected": expected_text,
            "url": snapshot["url"],
            "ok": ok,
            "horizontalOverflow": snapshot["scrollWidth"] > snapshot["width"] + 1,
        }
    )
    assert_true(expected_text in snapshot["text"], f"{path} で「{expected_text}」が表示されていません。")
    assert_true(
        snapshot["scrollWidth"] <= snapshot["width"] + 1,
        f"{path} で横スクロールが発生しています。",
    )

print(json.dumps({"status": "ok", "patientHref": patient_href, "checks": results}, ensure_ascii=False, indent=2))
