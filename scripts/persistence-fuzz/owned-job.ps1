param([int]$WorkerPid)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FuzzJob {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint n);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] public struct Extended { public Basic basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
}
"@
$job = [FuzzJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { throw 'CreateJobObject failed' }
try {
    $info = New-Object FuzzJob+Extended
    $limits = New-Object FuzzJob+Basic
    $limits.flags = 0x2000
    $info.basic = $limits
    $size = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        [Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false)
        if (-not [FuzzJob]::SetInformationJobObject($job, 9, $ptr, $size)) { throw 'SetInformationJobObject failed' }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
    $worker = [Diagnostics.Process]::GetProcessById($WorkerPid)
    if (-not [FuzzJob]::AssignProcessToJobObject($job, $worker.Handle)) { throw 'AssignProcessToJobObject failed' }
    [Console]::Out.WriteLine('owned')
    [Console]::Out.Flush()
    $null = [Console]::In.ReadLine()
} finally { $null = [FuzzJob]::CloseHandle($job) }
