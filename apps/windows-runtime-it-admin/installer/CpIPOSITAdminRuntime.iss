#define AppName "CpIPOS IT Admin"
#define AppPublisher "Cutting Point Tech Co., Ltd."
#define AppExeName "Cpipos.ITAdminRuntime.exe"
#define AppIconName "cpipos.ico"

#ifndef AppVersion
#define AppVersion "0.1.1"
#endif

#ifndef SourceDir
#define SourceDir "..\..\..\artifacts\CpIPOS-ITAdminRuntime-win-x64"
#endif

#ifndef OutputDir
#define OutputDir "..\..\..\artifacts"
#endif

#ifndef IconFile
#define IconFile "..\Cpipos.ITAdminRuntime\assets\cpipos.ico"
#endif

[Setup]
AppId={{CEDFC27E-D627-4DEA-B1D0-6B8BBC6A4E2B}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\CpIPOSITAdmin
DefaultGroupName=CpIPOS IT Admin
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=CpIPOS-ITAdminRuntime-Setup
SetupIconFile={#IconFile}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\assets\{#AppIconName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#IconFile}"; DestDir: "{app}"; DestName: "{#AppIconName}"; Flags: ignoreversion
Source: "{#IconFile}"; DestDir: "{app}\assets"; DestName: "{#AppIconName}"; Flags: ignoreversion

[Icons]
Name: "{group}\CpIPOS IT Admin"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0
Name: "{userdesktop}\CpIPOS IT Admin"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch CpIPOS IT Admin"; Flags: nowait postinstall skipifsilent
