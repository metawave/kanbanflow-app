@echo off
:: Buildscript for App on Windows

echo #
echo ##
echo ### Building kanbanflow application
echo ##
echo #
del /q kanbanflow-windows.zip

:: Install Dependencies
echo #
echo # Installing Dependencies...
echo #
call npm install

:: Build the app
echo #
echo # Build the application
echo #
del /q main.js*
call npm run-script compile

:: Package
echo #
echo # Package the application
echo #
rmdir /q /s kanbanflow-win32-x64
call npm run-script package

:: Package in a ZIP
echo #
echo # Creating ZIP File
echo #
call "%JAVA_HOME%\bin\jar.exe" cfM kanbanflow-windows.zip -C kanbanflow-win32-x64 .

:: Finished
echo #
echo # ^>^>^> Build Finished ^<^<^<
echo #
pause