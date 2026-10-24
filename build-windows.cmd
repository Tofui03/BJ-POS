@echo off
setlocal

rem One-command Windows updater/build for use over SSH.
rem Always run from this file's repository, regardless of the SSH start folder.
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on PATH.
  exit /b 1
)

echo [1/5] Pulling latest main branch...
git pull --ff-only
if errorlevel 1 exit /b 1

set "PNPM_CMD=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    where npx >nul 2>nul
    if errorlevel 1 (
      echo ERROR: pnpm, Corepack, and npx are not installed or are not on PATH.
      echo Install Node.js 22 LTS with npm, reconnect SSH, then run this script again.
      exit /b 1
    )
    echo pnpm and Corepack are not on PATH; using npx to run pnpm 10.33.0...
    set "PNPM_CMD=npx --yes pnpm@10.33.0"
  ) else (
    echo pnpm is not on PATH; using Corepack to run the repository's pinned pnpm version...
    set "PNPM_CMD=corepack pnpm"
  )
)

echo [2/5] Installing locked dependencies...
call %PNPM_CMD% install --frozen-lockfile
if errorlevel 1 exit /b 1

echo [3/5] Running tests...
call %PNPM_CMD% test
if errorlevel 1 exit /b 1

echo [4/5] Checking TypeScript and Vue...
call %PNPM_CMD% typecheck
if errorlevel 1 exit /b 1

echo [5/5] Building Windows installer and portable app...
call %PNPM_CMD% --filter @yf/pos dist:win
if errorlevel 1 exit /b 1

echo.
echo BUILD COMPLETE
echo Output: %~dp0apps\pos\release
exit /b 0
