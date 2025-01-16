#!/usr/bin/env bash

set -e
set -x

mypy app
ruff check app
ruff format app --check

mypy parser
ruff check parser
ruff format parser --check
