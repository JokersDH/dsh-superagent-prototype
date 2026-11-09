#!/bin/zsh -il
set -e
cd -- "${0:A:h}"
exec pnpm stop
