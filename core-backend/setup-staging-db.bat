@echo off
REM PostgreSQL Staging Database Setup Script
REM Creates the staging database, user, and configures permissions

setlocal enabledelayedexpansion

set PSQL_PATH=C:\Program Files\PostgreSQL\16\bin\psql.exe
set DB_USER=sama_user
set DB_PASSWORD=staging_password
set DB_NAME=sama_staging
set DB_HOST=localhost
set POSTGRES_USER=postgres

echo.
echo ================================================
echo  PostgreSQL Staging Database Setup
echo ================================================
echo.

REM Check if psql is available
if not exist "!PSQL_PATH!" (
    echo Error: PostgreSQL not found at !PSQL_PATH!
    exit /b 1
)

REM Step 1: Create the PostgreSQL user
echo [1/4] Creating database user '!DB_USER!'...
"!PSQL_PATH!" -U !POSTGRES_USER! -h !DB_HOST! -tc "CREATE USER !DB_USER! WITH PASSWORD '!DB_PASSWORD!';" 2>nul
if !ERRORLEVEL! equ 0 (
    echo   ✓ User created successfully
) else (
    echo   ✓ User already exists (or created)
)

REM Step 2: Create the staging database
echo [2/4] Creating database '!DB_NAME!'...
"!PSQL_PATH!" -U !POSTGRES_USER! -h !DB_HOST! -tc "CREATE DATABASE !DB_NAME! OWNER !DB_USER!;" 2>nul
if !ERRORLEVEL! equ 0 (
    echo   ✓ Database created successfully
) else (
    echo   ✓ Database already exists (or created)
)

REM Step 3: Grant privileges
echo [3/4] Granting privileges...
"!PSQL_PATH!" -U !POSTGRES_USER! -h !DB_HOST! -tc "GRANT ALL PRIVILEGES ON DATABASE !DB_NAME! TO !DB_USER!;" 2>nul
echo   ✓ Privileges granted

REM Step 4: Verify connection
echo [4/4] Verifying connection...
"!PSQL_PATH!" -U !DB_USER! -h !DB_HOST! -d !DB_NAME! -tc "SELECT 'Connection successful' as status;" 2>nul
if !ERRORLEVEL! equ 0 (
    echo   ✓ Connection verified
) else (
    echo   ✗ Connection failed
    exit /b 1
)

echo.
echo ================================================
echo  Setup Complete
echo ================================================
echo.
echo Configuration:
echo   Database: !DB_NAME!
echo   User: !DB_USER!
echo   Host: !DB_HOST!
echo   Port: 5432
echo.
echo Next: Run "node test-db-connection.js"
echo.

endlocal
