import time

from fastapi import APIRouter, Request

import config as cfg
from utils.log import get_log_id

router = APIRouter()


@router.get("/health")
async def health(req: Request):
    t0 = getattr(req.state, "t0", None)
    latency = round((time.time() - t0) * 1000, 1) if t0 else 0
    return {"code": 0, "msg": "ok", "logId": get_log_id(req),
            "data": {"status": "ok", "latency": latency, "version": cfg.APP_VERSION, "appName": cfg.APP_NAME}}
