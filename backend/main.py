import asyncio
import datetime as dt
import json
import math
import os
import threading
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
def _load_env_file() -> None:
  """Very small .env loader, only supports KEY=VALUE, ignores comments."""
  env_path = os.path.join(os.path.dirname(__file__), ".env")
  if not os.path.exists(env_path):
    return
  try:
    with open(env_path, "r", encoding="utf-8") as f:
      for raw in f:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
          continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        # 不加引号的简单场景足够用
        os.environ[key] = value
  except Exception:
    # if env file cannot be parsed, just skip
    pass


_load_env_file()


def _env(name: str, default: str = "") -> str:
  value = os.environ.get(name)
  if value is None or value == "":
    return default
  return value


def _parse_symbols(raw: str) -> List[str]:
  parts = [p.strip() for p in (raw or "").split(",")]
  return [p for p in parts if p]


COMMODITY_CATALOG: Dict[str, List[Dict[str, Any]]] = {
  "Energy": [
    {"code": "SC", "name": "Crude Oil", "exchange": "INE", "multiplier": 1000},
    {"code": "LU", "name": "Low Sulfur Fuel Oil", "exchange": "INE", "multiplier": 10},
    {"code": "FU", "name": "Fuel Oil", "exchange": "SHFE", "multiplier": 10},
    {"code": "BU", "name": "Bitumen", "exchange": "SHFE", "multiplier": 10},
  ],
  "Chemicals": [
    {"code": "TA", "name": "PTA", "exchange": "CZCE", "multiplier": 5},
    {"code": "MA", "name": "Methanol", "exchange": "CZCE", "multiplier": 10},
    {"code": "V", "name": "PVC", "exchange": "DCE", "multiplier": 5},
    {"code": "PP", "name": "Polypropylene", "exchange": "DCE", "multiplier": 5},
    {"code": "L", "name": "Linear PE", "exchange": "DCE", "multiplier": 5},
    {"code": "SA", "name": "Soda Ash", "exchange": "CZCE", "multiplier": 20},
  ],
}


REFERENCE_SPOT: Dict[str, Dict[str, Any]] = {
  "SC": {"price": 560.0, "source": "Ref: SMM"},
  "LU": {"price": 4300.0, "source": "Ref: Business社"},
  "FU": {"price": 3450.0, "source": "Ref: Business社"},
  "BU": {"price": 3680.0, "source": "Ref: SMM"},
  "TA": {"price": 5900.0, "source": "Ref: Business社"},
  "MA": {"price": 2550.0, "source": "Ref: Business社"},
  "V": {"price": 5850.0, "source": "Ref: SMM"},
  "PP": {"price": 7400.0, "source": "Ref: SMM"},
  "L": {"price": 8050.0, "source": "Ref: SMM"},
  "SA": {"price": 2000.0, "source": "Ref: Business社"},
}


def _is_valid_number(value: Any) -> bool:
  if value is None:
    return False
  try:
    x = float(value)
  except Exception:
    return False
  return not math.isnan(x) and not math.isinf(x)


def _norm_quote_symbol(code: str) -> str:
  return code.lower() if code.upper() not in {"TA", "MA", "SA"} else code.upper()


def _extract_code(symbol: str) -> str:
  raw = symbol.split(".")[-1]
  letters = "".join([ch for ch in raw if ch.isalpha()])
  return letters.upper()


def _flatten_catalog() -> Dict[str, Dict[str, Any]]:
  out: Dict[str, Dict[str, Any]] = {}
  for sector, items in COMMODITY_CATALOG.items():
    for item in items:
      out[item["code"]] = {
        "sector": sector,
        "name": item["name"],
        "exchange": item["exchange"],
        "multiplier": item["multiplier"],
      }
  return out


def fetch_reference_spot(symbol_or_code: str) -> Dict[str, Any]:
  code = symbol_or_code if "." not in symbol_or_code else _extract_code(symbol_or_code)
  ref = REFERENCE_SPOT.get(code.upper())
  if not ref:
    return {"referenceSpot": None, "spotSource": "Ref: Internal", "code": code.upper()}
  return {
    "referenceSpot": float(ref["price"]),
    "spotSource": str(ref["source"]),
    "code": code.upper(),
  }


def _candidate_contracts(exchange: str, code: str, months_forward: int = 10) -> List[str]:
  now = dt.datetime.now()
  candidates: List[str] = []
  for i in range(months_forward):
    month = now.month + i
    year = now.year + (month - 1) // 12
    m = ((month - 1) % 12) + 1
    yymm = f"{year % 100:02d}{m:02d}"
    candidates.append(f"{exchange}.{_norm_quote_symbol(code)}{yymm}")
  return candidates


def _resolve_main_contracts(api: Any) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
  flat = _flatten_catalog()
  symbols: List[str] = []
  meta_by_symbol: Dict[str, Dict[str, Any]] = {}

  for code, meta in flat.items():
    cands = _candidate_contracts(meta["exchange"], code)
    quotes = {s: api.get_quote(s) for s in cands}

    # Give tqsdk a few updates to populate depth / volume.
    for _ in range(6):
      api.wait_update()

    best_symbol = cands[0]
    best_score = -1.0
    for sym in cands:
      q = quotes[sym]
      vol = float(q.volume) if _is_valid_number(getattr(q, "volume", None)) else 0.0
      oi = float(q.open_interest) if _is_valid_number(getattr(q, "open_interest", None)) else 0.0
      score = vol * 1000 + oi
      if score > best_score:
        best_score = score
        best_symbol = sym

    symbols.append(best_symbol)
    meta_by_symbol[best_symbol] = {
      "code": code,
      "sector": meta["sector"],
      "displayName": meta["name"],
      "contractMultiplier": meta["multiplier"],
    }

  return symbols, meta_by_symbol


app = FastAPI(title="SimNow Tick Stream")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

clients: Set[WebSocket] = set()
tick_queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=1000)
runtime_state: Dict[str, Any] = {"subscribed": [], "symbolMeta": {}}
latest_hello: Optional[Dict[str, Any]] = None
latest_tick_by_code: Dict[str, Dict[str, Any]] = {}
# SimNow/CTP 连接状态，供 /ctp-status 查询
ctp_status: Dict[str, Any] = {"status": "idle", "message": ""}


async def _broadcast_loop() -> None:
  while True:
    msg = await tick_queue.get()

    global latest_hello
    if isinstance(msg, dict) and msg.get("type") == "hello":
      latest_hello = msg
    elif isinstance(msg, dict) and msg.get("type") == "tick":
      code = msg.get("code")
      if code:
        latest_tick_by_code[str(code)] = msg

    dead: List[WebSocket] = []
    if not clients:
      continue

    message = json.dumps(msg, ensure_ascii=False)
    for ws in list(clients):
      try:
        await ws.send_text(message)
      except Exception:
        dead.append(ws)
    for ws in dead:
      clients.discard(ws)


def _start_tqsdk_thread(loop: asyncio.AbstractEventLoop) -> None:
  
  global ctp_status
  ctp_status["status"] = "connecting"
  ctp_status["message"] = "正在连接天勤行情..."

  # 禁用 SOCKS 代理检测，避免需要 python-socks
  os.environ["TQ_NOSOCKS"] = "1"

  # 这里直接写死天勤账号；后面你愿意可以改回从 .env 读取
  tq_user = "17372207809"
  tq_password = "sharon2313309019@outlook.com"

  try:
    from tqsdk import TqApi, TqAuth
  except Exception as e:
    raise RuntimeError("tqsdk not installed. pip install -r backend/requirements.txt") from e

  if not tq_user or not tq_password:
    raise RuntimeError("Missing TianQin account for TqAuth")

  # 不传 account，只用天勤云行情
  api = TqApi(auth=TqAuth(tq_user, tq_password))

  # 订阅的合约列表（更新为 2605/2606 合约）
  symbols = [
    "INE.sc2605",   # 原油 2605
    "INE.lu2605",   # 低硫燃料油 2605
    "SHFE.fu2605",  # 燃料油 2605
    "SHFE.bu2605",  # 沥青 2605
    "CZCE.TA605",   # PTA 605（6月合约）
    "CZCE.MA605",   # 甲醇 605（6月合约）
    "DCE.v2605",    # PVC 2605
    "DCE.pp2605",   # 聚丙烯 2605
    "DCE.l2605",    # 聚乙烯 2605
    "CZCE.SA605",   # 纯碱 605（6月合约）
  ]

  flat = _flatten_catalog()
  symbol_meta: Dict[str, Dict[str, Any]] = {}
  for sym in symbols:
    code = _extract_code(sym)
    meta = flat.get(code, {})
    symbol_meta[sym] = {
      "code": code,
      "sector": meta.get("sector", "Other"),
      "displayName": meta.get("name", code),
      "contractMultiplier": int(meta.get("multiplier", 1)),
    }

  runtime_state["subscribed"] = symbols
  runtime_state["symbolMeta"] = symbol_meta
  ctp_status["status"] = "connected"
  ctp_status["message"] = f"天勤行情已连接，已订阅 {len(symbols)} 个合约"

  quotes = {sym: api.get_quote(sym) for sym in symbols}

  # 通知前端当前订阅情况
  hello_msg: Dict[str, Any] = {
    "type": "hello",
    "subscribed": symbols,
    "symbolMeta": symbol_meta,
    "catalog": COMMODITY_CATALOG,
  }

  def _push_hello() -> None:
    if tick_queue.full():
      try:
        tick_queue.get_nowait()
      except Exception:
        pass
    tick_queue.put_nowait(hello_msg)

  loop.call_soon_threadsafe(_push_hello)

  # 等一小段时间让行情初始化
  for _ in range(12):
    api.wait_update()

  # 初始快照：用 last_price / close / pre_close 等字段填一次
  for sym, q in quotes.items():
    meta = symbol_meta.get(sym, {})
    spot_meta = fetch_reference_spot(sym)

    def _pick_price() -> Optional[float]:
      for field in (
        "last_price",
        "close",
        "pre_close",
        "settlement",
        "pre_settlement",
      ):
        v = getattr(q, field, None)
        if _is_valid_number(v):
          return float(v)
      return None

    base_price = _pick_price()
    tick: Dict[str, Any] = {
      "type": "tick",
      "symbol": sym,
      "code": meta.get("code", _extract_code(sym)),
      "sector": meta.get("sector", "Other"),
      "displayName": meta.get("displayName", _extract_code(sym)),
      "contractMultiplier": meta.get("contractMultiplier", 1),
      "lastPrice": base_price,
      "bidPrice1": float(getattr(q, "bid_price1", 0.0))
      if _is_valid_number(getattr(q, "bid_price1", None))
      else None,
      "askPrice1": float(getattr(q, "ask_price1", 0.0))
      if _is_valid_number(getattr(q, "ask_price1", None))
      else None,
      "datetime": str(getattr(q, "datetime", "")) or "",
      "referenceSpot": spot_meta["referenceSpot"],
      "spotSource": spot_meta["spotSource"],
    }

    def _push_snapshot() -> None:
      if tick_queue.full():
        try:
          tick_queue.get_nowait()
        except Exception:
          pass
      tick_queue.put_nowait(tick)

    loop.call_soon_threadsafe(_push_snapshot)

  # 持续更新：只要 last_price 变化就推一个 tick
  while True:
    api.wait_update()
    for sym, q in quotes.items():
      if not api.is_changing(q, "last_price"):
        continue

      meta = symbol_meta.get(sym, {})
      spot_meta = fetch_reference_spot(sym)
      tick: Dict[str, Any] = {
        "type": "tick",
        "symbol": sym,
        "code": meta.get("code", _extract_code(sym)),
        "sector": meta.get("sector", "Other"),
        "displayName": meta.get("displayName", _extract_code(sym)),
        "contractMultiplier": meta.get("contractMultiplier", 1),
        "lastPrice": float(q.last_price) if q.last_price is not None else None,
        "bidPrice1": float(q.bid_price1) if q.bid_price1 is not None else None,
        "askPrice1": float(q.ask_price1) if q.ask_price1 is not None else None,
        "datetime": str(getattr(q, "datetime", "")) or "",
        "referenceSpot": spot_meta["referenceSpot"],
        "spotSource": spot_meta["spotSource"],
      }

      def _push() -> None:
        if tick_queue.full():
          try:
            tick_queue.get_nowait()
          except Exception:
            pass
        tick_queue.put_nowait(tick)

      loop.call_soon_threadsafe(_push)


@app.on_event("startup")
async def _on_startup() -> None:
  asyncio.create_task(_broadcast_loop())
  loop = asyncio.get_running_loop()

  def runner() -> None:
    global ctp_status
    try:
      _start_tqsdk_thread(loop)
    except Exception as exc:
      msg = str(exc)
      ctp_status["status"] = "error"
      ctp_status["message"] = msg

      def _push_err() -> None:
        if tick_queue.full():
          try:
            tick_queue.get_nowait()
          except Exception:
            pass
        tick_queue.put_nowait({"type": "error", "message": msg})

      loop.call_soon_threadsafe(_push_err)

  threading.Thread(target=runner, daemon=True).start()


@app.get("/health")
async def health() -> Dict[str, str]:
  return {"status": "ok"}


@app.get("/ctp-status")
async def get_ctp_status() -> Dict[str, Any]:
  return {
    "status": ctp_status.get("status", "idle"),
    "message": ctp_status.get("message", ""),
    "subscribed_count": len(runtime_state.get("subscribed", [])),
    "subscribed": runtime_state.get("subscribed", []),
  }


@app.get("/ticks")
async def get_ticks() -> Dict[str, Any]:
  return {
    "subscribed": runtime_state.get("subscribed", []),
    "symbolMeta": runtime_state.get("symbolMeta", {}),
    "ticks": latest_tick_by_code,
  }


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
  await websocket.accept()
  clients.add(websocket)
  try:
    if latest_hello:
      await websocket.send_json(latest_hello)
    else:
      await websocket.send_json({
        "type": "hello",
        "subscribed": runtime_state.get("subscribed", []),
        "symbolMeta": runtime_state.get("symbolMeta", {}),
        "catalog": COMMODITY_CATALOG,
      })

    for _, tick in list(latest_tick_by_code.items()):
      try:
        await websocket.send_text(json.dumps(tick, ensure_ascii=False))
      except Exception:
        pass

    while True:
      await websocket.receive_text()
  except WebSocketDisconnect:
    clients.discard(websocket)
  except Exception:
    clients.discard(websocket)