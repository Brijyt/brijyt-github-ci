#!/usr/bin/env python3
"""Trigger a workflow_dispatch on another repo and wait for completion."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def _github_request(
    method: str,
    url: str,
    token: str,
    payload: dict | None = None,
) -> dict | None:
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"GitHub API {method} {url} failed with HTTP {exc.code}: {error_body}"
        ) from exc


def _write_output(name: str, value: str) -> None:
    output_file = os.environ.get("GITHUB_OUTPUT")
    if not output_file:
        return
    with open(output_file, "a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def _parse_iso8601(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).astimezone(timezone.utc)


def main() -> int:
    token = _env("GITHUB_TOKEN")
    target_repo = _env("TARGET_REPO")
    target_workflow = _env("TARGET_WORKFLOW")
    target_ref = _env("TARGET_REF", "main")
    inputs_json = _env("INPUTS_JSON", "{}")
    poll_interval = int(_env("POLL_INTERVAL", "30"))
    timeout_seconds = int(_env("TIMEOUT", "3600"))

    try:
        inputs = json.loads(inputs_json)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"INPUTS_JSON is not valid JSON: {exc}") from exc
    if not isinstance(inputs, dict):
        raise SystemExit("INPUTS_JSON must be a JSON object")

    api_base = "https://api.github.com"
    dispatch_url = (
        f"{api_base}/repos/{target_repo}/actions/workflows/"
        f"{target_workflow}/dispatches"
    )
    runs_url = (
        f"{api_base}/repos/{target_repo}/actions/workflows/"
        f"{target_workflow}/runs"
    )

    dispatch_started_at = datetime.now(timezone.utc)
    print(
        f"Triggering workflow_dispatch on {target_repo}/{target_workflow} "
        f"(ref={target_ref}, inputs={inputs})"
    )
    _github_request(
        "POST",
        dispatch_url,
        token,
        {"ref": target_ref, "inputs": inputs},
    )

    time.sleep(10)
    deadline = time.monotonic() + timeout_seconds
    run_id: int | None = None
    run_url = ""

    while time.monotonic() < deadline:
        query = (
            f"?branch={urllib.parse.quote(target_ref)}"
            f"&event=workflow_dispatch&per_page=10"
        )
        runs_payload = _github_request("GET", runs_url + query, token)
        if runs_payload is None:
            raise SystemExit("Unexpected empty response when listing workflow runs")

        for run in runs_payload.get("workflow_runs", []):
            created_at = _parse_iso8601(run["created_at"])
            if created_at >= dispatch_started_at:
                run_id = run["id"]
                run_url = run["html_url"]
                print(f"Found workflow run {run_id}: {run_url}")
                break

        if run_id is not None:
            break

        print("Waiting for workflow run to appear...")
        time.sleep(poll_interval)

    if run_id is None:
        conclusion = "timed_out"
        _write_output("e2e_conclusion", conclusion)
        _write_output("e2e_run_url", "")
        print("Timed out waiting for workflow run to appear")
        return 1

    while time.monotonic() < deadline:
        run_payload = _github_request(
            "GET",
            f"{api_base}/repos/{target_repo}/actions/runs/{run_id}",
            token,
        )
        if run_payload is None:
            raise SystemExit(f"Unexpected empty response for workflow run {run_id}")

        status = run_payload.get("status")
        conclusion = run_payload.get("conclusion")
        run_url = run_payload.get("html_url", run_url)
        print(f"Run {run_id} status={status} conclusion={conclusion}")

        if status == "completed":
            final_conclusion = conclusion or "failure"
            _write_output("e2e_conclusion", final_conclusion)
            _write_output("e2e_run_url", run_url)
            if final_conclusion == "success":
                print(f"Workflow run succeeded: {run_url}")
            else:
                print(
                    f"Workflow run finished with conclusion={final_conclusion}: {run_url}"
                )
            return 0

        time.sleep(poll_interval)

    conclusion = "timed_out"
    _write_output("e2e_conclusion", conclusion)
    _write_output("e2e_run_url", run_url)
    print(f"Timed out waiting for workflow run {run_id} to complete")
    return 1


if __name__ == "__main__":
    sys.exit(main())
