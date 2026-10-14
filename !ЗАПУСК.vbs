Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
bat = fso.BuildPath(root, "GameScorePad.bat")
sh.Run "cmd /c """ & bat & """", 0, False
