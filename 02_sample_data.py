#!/usr/bin/env python3
"""
Generiše i ubacuje realistične VoLTE PM podatke u ClickHouse.
Instaliraj: pip install requests
Pokreni: python3 02_sample_data.py [--host localhost] [--port 8123]
"""

import json
import math
import random
import argparse
from datetime import datetime, timedelta

import requests

# ── Argumenti ─────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--host", default="localhost")
parser.add_argument("--port", default=8123, type=int)
parser.add_argument("--days", default=7, type=int, help="Broj dana za koje se generišu podaci")
args = parser.parse_args()

CH_URL = f"http://{args.host}:{args.port}/"
CH_DB  = "volte_kpi"

def ch_exec(sql: str, body: str = ""):
    target = sql if not body else f"INSERT INTO {CH_DB}.pm_counters FORMAT JSONEachRow"
    resp = requests.post(CH_URL, params={"database": CH_DB, "query": sql if not body else target},
                         data=body.encode("utf-8"))
    if resp.status_code != 200:
        raise Exception(f"ClickHouse error: {resp.text[:400]}")
    return resp.text

# ── Topologija mreže ──────────────────────────────────
# klaster -> stanica -> [band, ...]
NETWORK = {
    "CENTAR_BGD": {
        "BGD_CEN_001": ["1800", "800"],
        "BGD_CEN_002": ["1800", "2100", "800"],
        "BGD_CEN_003": ["1800", "2100"],
        "BGD_CEN_004": ["1800", "800"],
    },
    "SEVER_BGD": {
        "BGD_SEV_001": ["1800", "800"],
        "BGD_SEV_002": ["2100", "800"],
        "BGD_SEV_003": ["1800", "1800", "800"],  # dve 1800 sektore
    },
    "NOVI_SAD": {
        "NS_001": ["1800", "800"],
        "NS_002": ["2100", "800"],
        "NS_003": ["1800", "800"],
        "NS_004": ["1800", "2100"],
    },
    "ZEMUN": {
        "ZEM_001": ["1800", "800"],
        "ZEM_002": ["1800", "2100"],
        "ZEM_003": ["800"],
    },
}

# Loše ćelije za interesantne podatke
BAD_CELLS = {"BGD_CEN_002_2100_1", "BGD_SEV_002_800_1", "NS_003_800_1", "ZEM_002_2100_1"}

def load_factor(hour: int) -> float:
    """Simulira dnevni profil saobraćaja."""
    profile = [0.12, 0.08, 0.07, 0.06, 0.08, 0.20,
               0.50, 0.75, 0.95, 1.00, 0.98, 0.95,
               0.85, 0.80, 0.90, 0.95, 0.98, 0.90,
               0.75, 0.65, 0.55, 0.45, 0.30, 0.18]
    return profile[hour]

def gen_row(dt: datetime, klaster: str, stanica: str, celija: str, band: str) -> dict:
    is_bad = celija in BAD_CELLS
    lf     = load_factor(dt.hour)

    base_rrc = {"800": 1200, "1800": 3500, "2100": 2800}[band]
    scale    = random.uniform(0.85, 1.15) * lf

    def succ() -> float:
        return random.uniform(0.972, 0.985) if is_bad else random.uniform(0.992, 0.9995)

    # ── RRC ───────────────────────────────────────────
    att_mod  = max(10, int(base_rrc * scale * random.uniform(0.68, 1.0)))
    att_mta  = max(1,  int(base_rrc * scale * random.uniform(0.12, 0.22)))
    att_hpa  = max(1,  int(base_rrc * scale * random.uniform(0.02, 0.06)))
    re_mod   = int(att_mod * random.uniform(0.01, 0.025))
    re_mta   = int(att_mta * random.uniform(0.01, 0.025))
    re_hpa   = int(att_hpa * random.uniform(0.01, 0.025))
    fail_mme = int((att_mod + att_mta + att_hpa) * random.uniform(0.001, 0.008))

    suc_mod  = max(0, int((att_mod - re_mod - fail_mme) * succ()))
    suc_mta  = max(0, int(att_mta * succ()))
    suc_hpa  = max(0, int(att_hpa * succ()))

    # ── S1 ────────────────────────────────────────────
    s1a_mod  = max(1, int((att_mod - re_mod) * random.uniform(0.985, 1.0)))
    s1a_mta  = max(1, int(att_mta * random.uniform(0.985, 1.0)))
    s1a_hpa  = max(1, int(att_hpa * random.uniform(0.985, 1.0)))
    s1s_mod  = max(0, int(s1a_mod * succ()))
    s1s_mta  = max(0, int(s1a_mta * succ()))
    s1s_hpa  = max(0, int(s1a_hpa * succ()))

    # ── ERAB QCI1 (glas) ──────────────────────────────
    ei1_att  = max(10, int(base_rrc * scale * 0.28 * random.uniform(0.8, 1.2)))
    ea1_att  = max(1,  int(ei1_att * random.uniform(0.18, 0.35)))
    eaho1    = max(0,  int(ea1_att * random.uniform(0.35, 0.60)))
    ei1_suc  = max(0,  int(ei1_att * succ()))
    ea1_suc  = max(0,  int(ea1_att * succ()))

    # ── ERAB QCI5 (IMS signaling) ─────────────────────
    ei5_att  = max(10, int(ei1_att * random.uniform(0.90, 1.10)))
    ea5_att  = max(1,  int(ea1_att * random.uniform(0.40, 0.65)))
    eaho5    = max(0,  int(ea5_att * random.uniform(0.35, 0.60)))
    ei5_suc  = max(0,  int(ei5_att * succ()))
    ea5_suc  = max(0,  int(ea5_att * succ()))

    # ── ERAB Release QCI1 ─────────────────────────────
    total_erab    = ei1_suc + ea1_suc
    drop_rate_enb = random.uniform(0.02, 0.05) if is_bad else random.uniform(0.003, 0.010)
    drop_rate_mme = random.uniform(0.01, 0.03) if is_bad else random.uniform(0.001, 0.005)
    rel_abn_enb   = max(0, int(total_erab * drop_rate_enb))
    rel_abn_mme   = max(0, int(total_erab * drop_rate_mme))
    rel_abn_enb_act = max(0, int(rel_abn_enb * random.uniform(0.60, 0.80)))
    rel_abn_mme_act = max(0, int(rel_abn_mme * random.uniform(0.60, 0.80)))
    rel_nor_enb   = max(0, total_erab - rel_abn_enb - rel_abn_mme)
    rel_mme       = max(0, int(total_erab * random.uniform(0.01, 0.04)))

    # ERAB Level Sum → Erlang proxy
    avg_dur_min   = random.uniform(1.8, 3.5)  # prosečno trajanje poziva u minutama
    erab_lev_sum  = int(total_erab * (avg_dur_min / 60.0) * 720)

    # ── VoIP Quality ──────────────────────────────────
    voip_ok   = max(0, int(total_erab * (random.uniform(0.92, 0.97) if is_bad else random.uniform(0.96, 0.998))))
    voip_nok  = max(0, int(total_erab * (random.uniform(0.03, 0.08) if is_bad else random.uniform(0.002, 0.04))))

    # ── PDCCH VoLTE ───────────────────────────────────
    pdcch_dl      = max(1, int(total_erab * random.uniform(90, 160)))
    pdcch_ul      = max(1, int(total_erab * random.uniform(70, 130)))
    ul_no_ack     = max(0, int(pdcch_ul * random.uniform(0.01, 0.04)))
    pdcch_err     = random.uniform(0.025, 0.08) if is_bad else random.uniform(0.005, 0.025)
    dl_ack        = max(0, int((pdcch_dl) * (1 - pdcch_err)))
    ul_pusch      = max(0, int((pdcch_ul - ul_no_ack) * (1 - pdcch_err)))

    # ── Handover QCI1 ─────────────────────────────────
    ho_att       = max(1, int(eaho1))
    ho_suc       = max(0, int(ho_att * (random.uniform(0.920, 0.965) if is_bad else random.uniform(0.975, 0.999))))

    return {
        "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
        "stanica": stanica, "celija": celija,
        "klaster": klaster, "band": band,
        "vendor": "Ericsson", "region": "Srbija",
        "pmRrcConnEstabSuccMod": suc_mod,
        "pmRrcConnEstabSuccMta": suc_mta,
        "pmRrcConnEstabSuccHpa": suc_hpa,
        "pmRrcConnEstabAttMod": att_mod,
        "pmRrcConnEstabAttMta": att_mta,
        "pmRrcConnEstabAttHpa": att_hpa,
        "pmRrcConnEstabAttReattMod": re_mod,
        "pmRrcConnEstabAttReattMta": re_mta,
        "pmRrcConnEstabAttReattHpa": re_hpa,
        "pmRrcConnEstabFailMmeOvlMod": fail_mme,
        "pmS1SigConnEstabSuccMod": s1s_mod,
        "pmS1SigConnEstabSuccMta": s1s_mta,
        "pmS1SigConnEstabSuccHpa": s1s_hpa,
        "pmS1SigConnEstabAttMod": s1a_mod,
        "pmS1SigConnEstabAttMta": s1a_mta,
        "pmS1SigConnEstabAttHpa": s1a_hpa,
        "pmErabEstabSuccInitQci1": ei1_suc,
        "pmErabEstabSuccAddedQci1": ea1_suc,
        "pmErabEstabAttInitQci1": ei1_att,
        "pmErabEstabAttAddedQci1": ea1_att,
        "pmErabEstabAttAddedHoOngoingQci1": eaho1,
        "pmErabRelAbnormalEnbQci1": rel_abn_enb,
        "pmErabRelAbnormalMmeQci1": rel_abn_mme,
        "pmErabRelNormalEnbQci1": rel_nor_enb,
        "pmErabRelMmeQci1": rel_mme,
        "pmErabQciLevSum1": erab_lev_sum,
        "pmErabRelAbnormalEnbActQci1": rel_abn_enb_act,
        "pmErabRelAbnormalMmeActQci1": rel_abn_mme_act,
        "pmErabEstabSuccInitQci5": ei5_suc,
        "pmErabEstabSuccAddedQci5": ea5_suc,
        "pmErabEstabAttInitQci5": ei5_att,
        "pmErabEstabAttAddedQci5": ea5_att,
        "pmErabEstabAttAddedHoOngoingQci5": eaho5,
        "pmVoipQualityRbUlOk": voip_ok,
        "pmVoipQualityRbUlNok": voip_nok,
        "pmDlAssigsTransVolte": pdcch_dl,
        "pmUlGrantsTransVolte": pdcch_ul,
        "pmUlGrantsTransVolteNoAck": ul_no_ack,
        "pmDlAssigsWithDetectedHarqAckVolte": dl_ack,
        "pmUlGrantsWithDetectedPuschVolte": ul_pusch,
        "pmHoExeOutSuccQci1": ho_suc,
        "pmHoExeOutAttQci1": ho_att,
    }

def build_cell_list():
    cells = []
    for klaster, stations in NETWORK.items():
        for stanica, bands in stations.items():
            seen_bands = {}
            for band in bands:
                seen_bands[band] = seen_bands.get(band, 0) + 1
                idx    = seen_bands[band]
                celija = f"{stanica}_{band}_{idx}"
                cells.append((klaster, stanica, celija, band))
    return cells

def main():
    random.seed(42)
    cells    = build_cell_list()
    end_dt   = datetime.now().replace(minute=0, second=0, microsecond=0)
    start_dt = end_dt - timedelta(days=args.days)

    print(f"Generišem {args.days} dana podataka za {len(cells)} ćelija...")
    print(f"Opseg: {start_dt}  →  {end_dt}")

    batch: list[str] = []
    total = 0
    BATCH_SIZE = 200

    dt = start_dt
    while dt < end_dt:
        for klaster, stanica, celija, band in cells:
            row = gen_row(dt, klaster, stanica, celija, band)
            batch.append(json.dumps(row))
            if len(batch) >= BATCH_SIZE:
                ch_exec("", "\n".join(batch))
                total += len(batch)
                print(f"\r  Ubačeno {total} redova...", end="", flush=True)
                batch.clear()
        dt += timedelta(hours=1)

    if batch:
        ch_exec("", "\n".join(batch))
        total += len(batch)

    print(f"\nGotovo! Ukupno {total} redova upisano u {CH_DB}.pm_counters")

if __name__ == "__main__":
    main()
