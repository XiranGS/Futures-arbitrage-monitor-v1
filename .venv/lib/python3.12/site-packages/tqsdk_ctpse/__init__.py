import base64
import ctypes
import sys
from pathlib import Path


class TqCTPSEUnsupportedPlatform(Exception):
    def __init__(self, platform):
        super().__init__(f"不支持该平台: {platform}")
        self.platform = platform


class TqCTPSEError(Exception):
    def __init__(self, code):
        super().__init__(f"采集失败错误码: {code}")
        self.code = code


def get_system_info():
    l = ctypes.c_int(344)
    buf = ctypes.create_string_buffer(l.value)
    lib_path = Path(__file__, '../').resolve()  # Make the path absolute, resolving any symlinks.
    if sys.platform.startswith("win"):
        if ctypes.sizeof(ctypes.c_voidp) == 4:
            ctpse_lib = ctypes.cdll.LoadLibrary(str(lib_path/"WinDataCollect32.dll"))
            ret = getattr(ctpse_lib, "?CTP_GetSystemInfo@@YAHPADAAH@Z")(buf, ctypes.byref(l))
        else:
            ctpse_lib = ctypes.cdll.LoadLibrary(str(lib_path/"WinDataCollect64.dll"))
            ret = getattr(ctpse_lib, "?CTP_GetSystemInfo@@YAHPEADAEAH@Z")(buf, ctypes.byref(l))
    elif sys.platform.startswith("linux"):
        ctpse_lib = ctypes.cdll.LoadLibrary(str(lib_path/"LinuxDataCollect64.so"))
        ret = ctpse_lib._Z17CTP_GetSystemInfoPcRi(buf, ctypes.byref(l))
    else:
        raise TqCTPSEUnsupportedPlatform(sys.platform)
    if ret == 0:
        return base64.b64encode(buf.raw[:l.value]).decode("utf-8")
    else:
        raise TqCTPSEError(ret)
