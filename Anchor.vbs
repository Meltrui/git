' ===================================================================
'  Anchor - hidden launcher (double-click to start)
'
'  IMPORTANT: this file is intentionally pure ASCII.
'  VBScript reads .vbs as ANSI, so any UTF-8 / Chinese text here would
'  break parsing silently. All user-facing Chinese messages live in
'  scripts/launch.mjs (Node, UTF-8 safe).
'
'  What it does: locate node.exe, run scripts/launch.mjs hidden.
'  The Node launcher then starts the server, opens the browser, and
'  shows a message box if anything goes wrong.
'  Startup trace: data\anchor-launch.log
' ===================================================================

Option Explicit

Dim fso, sh, root, dataDir, logFile, launchPath, nodeExe, cmdText, exitCode

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = root & "\data"
launchPath = root & "\scripts\launch.mjs"
logFile = dataDir & "\anchor-launch.log"

Trace "==== launch requested ====" 
Trace "root=" & root

If Not fso.FolderExists(dataDir) Then
  On Error Resume Next
  fso.CreateFolder dataDir
  On Error GoTo 0
End If

If Not fso.FileExists(launchPath) Then
  Trace "ERROR: missing " & launchPath
  MsgBox "launch.mjs not found: " & vbCrLf & launchPath & vbCrLf & vbCrLf & _
         "(Please keep Anchor.vbs and the scripts folder together.)", 16, "Anchor"
  WScript.Quit 1
End If

nodeExe = ResolveNode()
Trace "node=" & nodeExe

If nodeExe = "node" Then
  exitCode = sh.Run("cmd /c where node >nul 2>nul", 0, True)
  If exitCode <> 0 Then
    Trace "ERROR: node not found"
    MsgBox "Node.js not found." & vbCrLf & vbCrLf & _
           "Anchor needs Node.js 20 or newer." & vbCrLf & _
           "Install the LTS build from https://nodejs.org and try again.", 16, "Anchor"
    WScript.Quit 1
  End If
End If

sh.CurrentDirectory = root

cmdText = """" & nodeExe & """ """ & launchPath & """"
Trace "exec=" & cmdText

On Error Resume Next
sh.Run cmdText, 0, False
If Err.Number <> 0 Then
  Trace "ERROR: " & Err.Description
  MsgBox "Launch failed: " & Err.Description & vbCrLf & vbCrLf & _
         "Run start-anchor.cmd to see the details.", 16, "Anchor"
  WScript.Quit 1
End If
On Error GoTo 0

Trace "spawned (background)"

' ------------------------------------------------------------------

Sub Trace(msg)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(logFile, 8, True)
  If Err.Number = 0 Then
    f.WriteLine Stamp() & "  " & msg
    f.Close
  End If
  Err.Clear
  On Error GoTo 0
End Sub

Function Stamp()
  Stamp = Year(Now) & "-" & Pad2(Month(Now)) & "-" & Pad2(Day(Now)) & " " & _
          Pad2(Hour(Now)) & ":" & Pad2(Minute(Now)) & ":" & Pad2(Second(Now))
End Function

Function Pad2(n)
  Pad2 = Right("0" & CStr(n), 2)
End Function

Function ResolveNode()
  Dim candidates, i, p
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%APPDATA%\npm\node.exe") )
  For i = 0 To UBound(candidates)
    p = candidates(i)
    If Len(p) > 0 Then
      If InStr(p, "%") = 0 Then
        If fso.FileExists(p) Then
          ResolveNode = p
          Exit Function
        End If
      End If
    End If
  Next
  ResolveNode = "node"
End Function
