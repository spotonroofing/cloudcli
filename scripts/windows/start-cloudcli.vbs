' Starts the CloudCLI server hidden (no console window), for use as a
' Windows logon task. Resolves the repo root from this script's location
' (repo\scripts\windows\start-cloudcli.vbs), so it works from any checkout.
' Port/host/platform-mode config lives in the repo's .env file.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
shell.CurrentDirectory = repoRoot

' Belt and braces: .env already sets ANTHROPIC_API_KEY empty, but clear it at
' the process level too so spawned claude CLIs always bill the subscription.
shell.Environment("PROCESS")("ANTHROPIC_API_KEY") = ""

logDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cloudcli"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

shell.Run "cmd /c node dist-server\server\index.js >> """ & logDir & "\server.log"" 2>&1", 0, False
