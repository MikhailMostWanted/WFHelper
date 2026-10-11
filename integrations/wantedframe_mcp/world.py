from __future__ import annotations
import asyncio
import json
import time
import httpx
from .store import DataError, MAX_OUTPUT

SOURCES = ("https://api.warframe.com/cdn/worldState.php", "https://content.warframe.com/dynamic/worldState.php")
SECTIONS = {"ActiveMissions", "Alerts", "Sorties", "LiteSorties", "VoidTraders", "PrimeVaultTraders", "Invasions", "SyndicateMissions", "SeasonInfo", "CalendarSeasons", "DuviriCycle", "EndlessXpChoices", "Goals", "NodeOverrides", "VoidStorms"}
class World:
    def __init__(self):
        self.value = None; self.fetched_at = 0.; self.attempt_at = 0.; self.source = None
        self.lock = asyncio.Lock()
    async def read(self, section: str, offset: int, limit: int):
        if section and section not in SECTIONS: raise DataError("Choose a section from the world-state catalog")
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 30: raise DataError("Invalid page")
        async with self.lock:
            if time.time() - self.attempt_at > 60:
                self.attempt_at = time.time()
                async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
                    for url in SOURCES:
                        try:
                            async with client.stream("GET", url) as response:
                                response.raise_for_status(); chunks = []; size = 0
                                async for chunk in response.aiter_bytes():
                                    size += len(chunk)
                                    if size > 8 * 1024 * 1024: raise ValueError()
                                    chunks.append(chunk)
                            raw = json.loads(b"".join(chunks))
                            if not isinstance(raw, dict) or not any(k in raw for k in SECTIONS): raise ValueError()
                            self.value = {k: raw[k] for k in SECTIONS if k in raw}
                            self.fetched_at = time.time(); self.source = url; break
                        except (httpx.HTTPError, ValueError): continue
        if self.value is None: raise DataError("DE world state is unavailable. No live event data was obtained.")
        meta = {"source": self.source, "fetchedAt": int(self.fetched_at * 1000), "stale": time.time() - self.fetched_at > 120, "sourceIsUntrusted": True, "platform": "pc"}
        if not section:
            return {**meta, "sections": [{"id": k, "rows": len(v) if isinstance(v, list) else 1} for k, v in self.value.items()], "note": "Public events, not personal completion. Read a named section; dates are DE values."}
        if section not in self.value: return {**meta, "section": section, "available": False, "data": None}
        source = self.value[section]; rows = source if isinstance(source, list) else [source]
        result = []; end = offset
        for row in rows[offset:offset+limit]:
            if len(json.dumps([*result, row]).encode()) > MAX_OUTPUT:
                if not result: return {**meta, "section": section, "oversized": True, "note": "Selected record exceeds output limit", "nextOffset": None}
                break
            result.append(row); end += 1
        return {**meta, "section": section, "available": True, "data": result, "total": len(rows), "nextOffset": end if end < len(rows) else None}
