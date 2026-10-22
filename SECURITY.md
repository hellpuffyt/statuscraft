# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's advisory form:
https://github.com/hellpuffyt/statuscraft/security/advisories/new

Do not open a public issue for a suspected vulnerability.

## Scope

In scope:

- anything that lets the generated page show a status the result log does not
  support (for example green from missing, stale or malformed data);
- markup/script injection into the generated page from config, the result log
  or the incident overlay;
- `statuscraft serve` reading files outside the directory it serves.

`serve` is a local preview server (loopback only). Do not expose it to a
network; publish the generated static files with a real web server instead.

## Supported versions

Only the latest commit on `main` is supported.
