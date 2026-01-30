#!/usr/bin/env python3
"""
Scaleway Secret Manager - Fetch and Substitute Secrets

This script fetches secrets from Scaleway Secret Manager and substitutes
them in a JSON configuration file.

Variable format in config file:
  - ${VAR_NAME}           -> fetched from /{env}/VAR_NAME
  - ${/path/VAR_NAME}     -> fetched from /{env}/path/VAR_NAME

Usage:
    python fetch_secrets.py --config <file> --env <env> --project-id <id> [--region <region>]

Required environment variables:
    SCW_SECRET_KEY: Scaleway API secret key
"""

import argparse
import base64
import os
import re
import sys
from typing import Optional
from urllib.parse import quote

import requests


class ScalewaySecretManager:
    """Client for Scaleway Secret Manager API."""

    def __init__(self, secret_key: str, project_id: str, region: str = "fr-par"):
        self.secret_key = secret_key
        self.project_id = project_id
        self.region = region
        self.base_url = f"https://api.scaleway.com/secret-manager/v1beta1/regions/{region}"
        self.headers = {"X-Auth-Token": secret_key}
        self._secrets_cache: dict[str, list[dict]] = {}

    def list_secrets_by_path(self, path: str) -> list[dict]:
        """List all secrets in a given path (with caching)."""
        if path in self._secrets_cache:
            return self._secrets_cache[path]

        encoded_path = quote(path, safe="")
        url = f"{self.base_url}/secrets?project_id={self.project_id}&path={encoded_path}"

        response = requests.get(url, headers=self.headers, timeout=30)
        response.raise_for_status()

        secrets = response.json().get("secrets", [])
        self._secrets_cache[path] = secrets
        return secrets

    def access_secret_version(self, secret_id: str, version: str = "latest") -> str:
        """Access a secret version and return its decoded value."""
        url = f"{self.base_url}/secrets/{secret_id}/versions/{version}/access"

        response = requests.get(url, headers=self.headers, timeout=30)
        response.raise_for_status()

        data = response.json().get("data", "")
        if data:
            return base64.b64decode(data).decode("utf-8")
        return ""

    def get_secret_value(self, name: str, path: str) -> Optional[str]:
        """Get a secret value by name and path."""
        secrets = self.list_secrets_by_path(path)

        for secret in secrets:
            if secret.get("name") == name:
                return self.access_secret_version(secret["id"])

        return None


def parse_variable_pattern(pattern: str) -> tuple[str, str]:
    """
    Parse a variable pattern into (subpath, name).

    Examples:
        "VAR_NAME" -> ("", "VAR_NAME")
        "/integration-api/VAR_NAME" -> ("integration-api", "VAR_NAME")
    """
    if "/" in pattern:
        # Remove leading slash if present
        clean_pattern = pattern.lstrip("/")
        parts = clean_pattern.rsplit("/", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
    return "", pattern


def extract_variables(content: str) -> list[str]:
    """Extract all ${...} variable patterns from content."""
    return re.findall(r"\$\{([^}]+)\}", content)


def substitute_secrets(
    config_file: str,
    env: str,
    project_id: str,
    region: str,
    secret_key: str,
) -> tuple[int, list[str]]:
    """
    Fetch secrets and substitute them in the config file.

    Returns:
        Tuple of (success_count, failed_variables)
    """
    # Read config file
    with open(config_file, encoding="utf-8") as f:
        content = f.read()

    # Extract all variables
    variables = extract_variables(content)
    if not variables:
        print("[INFO] No variables found in config file")
        return 0, []

    print(f"[INFO] Found {len(variables)} variable(s) to substitute:")
    for var in variables:
        print(f"  - ${{{var}}}")

    # Initialize Scaleway client
    client = ScalewaySecretManager(secret_key, project_id, region)

    # Process each variable
    success_count = 0
    failed_vars = []

    for pattern in variables:
        subpath, name = parse_variable_pattern(pattern)

        # Construct full path: /{env}[/subpath]
        full_path = f"/{env}/{subpath}" if subpath else f"/{env}"

        print(f"[INFO] Looking for {name} in path {full_path}")

        try:
            value = client.get_secret_value(name, full_path)

            if value is None:
                print(f"[WARN] Secret not found: {full_path}/{name}")
                failed_vars.append(pattern)
                continue

            if not value:
                print(f"[WARN] Empty value for secret: {full_path}/{name}")
                failed_vars.append(pattern)
                continue

            print(f"[INFO] Substituting: ${{{pattern}}} (from {full_path}/{name})")

            # Escape for JSON (handle special characters)
            escaped_value = value.replace("\\", "\\\\").replace('"', '\\"')
            content = content.replace(f"${{{pattern}}}", escaped_value)
            success_count += 1

        except requests.RequestException as e:
            print(f"[ERROR] API error for {pattern}: {e}")
            failed_vars.append(pattern)

    # Write updated content back to file
    with open(config_file, "w", encoding="utf-8") as f:
        f.write(content)

    return success_count, failed_vars


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Fetch secrets from Scaleway Secret Manager and substitute in config file"
    )
    parser.add_argument(
        "--config", required=True, help="Path to the configuration file"
    )
    parser.add_argument(
        "--env",
        required=True,
        choices=["dev", "staging", "prod"],
        help="Environment name",
    )
    parser.add_argument(
        "--project-id", required=True, help="Scaleway project ID"
    )
    parser.add_argument(
        "--region", default="fr-par", help="Scaleway region (default: fr-par)"
    )

    args = parser.parse_args()

    # Get secret key from environment
    secret_key = os.environ.get("SCW_SECRET_KEY")
    if not secret_key:
        print("[ERROR] SCW_SECRET_KEY environment variable is required")
        sys.exit(1)

    # Validate config file exists
    if not os.path.isfile(args.config):
        print(f"[ERROR] Config file not found: {args.config}")
        sys.exit(1)

    print(f"[INFO] Starting secret substitution for environment: {args.env}")
    print(f"[INFO] Config file: {args.config}")
    print(f"[INFO] Project ID: {args.project_id}")
    print(f"[INFO] Region: {args.region}")

    # Perform substitution
    success_count, failed_vars = substitute_secrets(
        config_file=args.config,
        env=args.env,
        project_id=args.project_id,
        region=args.region,
        secret_key=secret_key,
    )

    print(f"[INFO] Successfully substituted {success_count} variable(s)")

    if failed_vars:
        print(f"[ERROR] Failed to substitute {len(failed_vars)} variable(s):")
        for var in failed_vars:
            print(f"  - ${{{var}}}")
        sys.exit(1)

    print("[INFO] Secret substitution completed successfully")


if __name__ == "__main__":
    main()
