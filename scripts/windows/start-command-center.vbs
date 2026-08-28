' Starts the Command Center server hidden (no console window), for use as a
' Windows logon task. Resolves the repo root from this script's location
' (repo\scripts\windows\start-command-center.vbs), so it works from any checkout.
' Port/host/platform-mode config lives in the repo's .env file.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
shell.CurrentDirectory = repoRoot

' Belt and braces: .env already sets ANTHROPIC_API_KEY empty, but clear it at
' the process level too so spawned Claude Code CLIs always bill the subscription.
shell.Environment("PROCESS")("ANTHROPIC_API_KEY") = ""

anchorCommand = "cmd /c node """ & repoRoot & "\shared\runtime-anchors.js"" --data-directory"
logDir = shell.Exec(anchorCommand).StdOut.ReadAll
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

shell.Run "cmd /c node dist-server\server\index.js >> """ & logDir & "\server.log"" 2>&1", 0, False
