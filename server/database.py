"""
ClickHouse Database Connection
Handles all database queries and connections
"""

import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from clickhouse_driver import Client, connect
from clickhouse_driver.errors import Error as CHError
import logging

from .config import settings, CLICKHOUSE_URL
from .models import KpiCellData, KpiMetrics, KpiQueryRequest

logger = logging.getLogger(__name__)


class ClickHouseClient:
    """Async ClickHouse client with connection pooling"""
    
    def __init__(self):
        self.client: Optional[Client] = None
        self.connection_params: Dict[str, Any] = {
            "host": settings.CH_HOST,
            "port": settings.CH_PORT,
            "user": settings.CH_USER,
            "password": settings.CH_PASSWORD,
            "database": settings.CH_DATABASE,
            "compression": True,
            "secure": False,
        }
    
    def connect(self) -> Client:
        """Establish database connection"""
        if self.client is None:
            try:
                self.client = connect(**self.connection_params)
                logger.info(f"Connected to ClickHouse at {CLICKHOUSE_URL}")
            except CHError as e:
                logger.error(f"Failed to connect to ClickHouse: {e}")
                raise
        return self.client
    
    def close(self):
        """Close database connection"""
        if self.client:
            self.client.disconnect()
            self.client = None
            logger.info("ClickHouse connection closed")
    
    def is_connected(self) -> bool:
        """Check if connection is active"""
        if self.client is None:
            return False
        try:
            self.client.execute("SELECT 1")
            return True
        except:
            return False
    
    def get_kpi_data(
        self, 
        hours: int = 24,
        cluster: Optional[str] = None,
        station: Optional[str] = None,
        cell: Optional[str] = None,
        band: Optional[str] = None,
        limit: int = 10000
    ) -> List[Dict[str, Any]]:
        """
        Fetch raw PM counter data from ClickHouse
        
        Args:
            hours: Time range in hours
            cluster: Filter by cluster
            station: Filter by station
            cell: Filter by cell
            band: Filter by band
            limit: Maximum number of records
            
        Returns:
            List of raw PM counter dictionaries
        """
        self.connect()
        
        # Build WHERE clause
        where_clauses = []
        params = {}
        
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        where_clauses.append("datetime >= %(start_time)s")
        where_clauses.append("datetime <= %(end_time)s")
        params["start_time"] = start_time
        params["end_time"] = end_time
        
        if cluster:
            where_clauses.append("klaster = %(cluster)s")
            params["cluster"] = cluster
        if station:
            where_clauses.append("stanica = %(station)s")
            params["station"] = station
        if cell:
            where_clauses.append("celija = %(cell)s")
            params["cell"] = cell
        if band:
            where_clauses.append("band = %(band)s")
            params["band"] = band
        
        where_clause = " AND ".join(where_clauses) if where_clauses else "1=1"
        
        query = f"""
        SELECT 
            datetime, stanica, celija, klaster, band,
            pmRrcConnEstabSuccMod, pmRrcConnEstabSuccMta, pmRrcConnEstabSuccHpa,
            pmRrcConnEstabAttMod, pmRrcConnEstabAttMta, pmRrcConnEstabAttHpa,
            pmRrcConnEstabAttReattMod, pmRrcConnEstabAttReattMta, pmRrcConnEstabAttReattHpa,
            pmRrcConnEstabFailMmeOvlMod,
            pmS1SigConnEstabSuccMod, pmS1SigConnEstabSuccMta, pmS1SigConnEstabSuccHpa,
            pmS1SigConnEstabAttMod, pmS1SigConnEstabAttMta, pmS1SigConnEstabAttHpa,
            pmErabEstabSuccInitQci1, pmErabEstabSuccAddedQci1,
            pmErabEstabAttInitQci1, pmErabEstabAttAddedQci1, pmErabEstabAttAddedHoOngoingQci1,
            pmErabRelAbnormalEnbQci1, pmErabRelAbnormalMmeQci1,
            pmErabRelNormalEnbQci1, pmErabRelMmeQci1,
            pmErabQciLevSum1,
            pmErabRelAbnormalEnbActQci1, pmErabRelAbnormalMmeActQci1,
            pmErabEstabSuccInitQci5, pmErabEstabSuccAddedQci5,
            pmErabEstabAttInitQci5, pmErabEstabAttAddedQci5, pmErabEstabAttAddedHoOngoingQci5,
            pmVoipQualityRbUlOk, pmVoipQualityRbUlNok,
            pmDlAssigsTransVolte, pmUlGrantsTransVolte, pmUlGrantsTransVolteNoAck,
            pmDlAssigsWithDetectedHarqAckVolte, pmUlGrantsWithDetectedPuschVolte,
            pmHoExeOutSuccQci1, pmHoExeOutAttQci1
        FROM pm_counters
        WHERE {where_clause}
        ORDER BY datetime DESC, klaster, stanica, celija
        LIMIT %(limit)s
        """
        
        try:
            result = self.client.execute(query, params, with_column_types=False)
            columns = [col[0] for col in self.client.execute(
                f"SELECT * FROM pm_counters LIMIT 1", 
                params, 
                with_column_types=True
            )]
            
            # Convert to list of dictionaries
            rows = []
            for row in result:
                row_dict = dict(zip(columns, row))
                # Convert datetime string to datetime object
                if 'datetime' in row_dict and isinstance(row_dict['datetime'], str):
                    row_dict['datetime'] = datetime.strptime(
                        str(row_dict['datetime']), 
                        "%Y-%m-%d %H:%M:%S"
                    )
                rows.append(row_dict)
            
            logger.info(f"Fetched {len(rows)} PM counter records")
            return rows
            
        except CHError as e:
            logger.error(f"ClickHouse query error: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error fetching KPI data: {e}")
            return []
    
    def get_latest_kpi(
        self, 
        hours: int = 24,
        limit: int = 1000,
        cluster: Optional[str] = None,
        station: Optional[str] = None,
        cell: Optional[str] = None,
        band: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get latest KPI data for each cell

        Args:
            hours: Time range in hours
            limit: Maximum number of records
            cluster: Filter by cluster
            station: Filter by station
            cell: Filter by cell
            band: Filter by band

        Returns:
            List of PM counter dictionaries (latest per cell)
        """
        self.connect()
        
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        # Build WHERE clause so filters are applied in SQL (uses skip indexes)
        where_clauses = ["datetime >= %(start_time)s", "datetime <= %(end_time)s"]
        params: Dict[str, Any] = {"start_time": start_time, "end_time": end_time}
        
        if cluster:
            where_clauses.append("klaster = %(cluster)s")
            params["cluster"] = cluster
        if station:
            where_clauses.append("stanica = %(station)s")
            params["station"] = station
        if cell:
            where_clauses.append("celija = %(cell)s")
            params["cell"] = cell
        if band:
            where_clauses.append("band = %(band)s")
            params["band"] = band
        
        where = " AND ".join(where_clauses) or "1=1"
        params["limit"] = limit
        
        query = f"""
        WITH latest_records AS (
            SELECT 
                celija, stanica, klaster, band,
                max(datetime) as latest_dt
            FROM pm_counters
            WHERE {where}
            GROUP BY celija, stanica, klaster, band
        )
        SELECT 
            c.datetime, c.stanica, c.celija, c.klaster, c.band,
            c.pmRrcConnEstabSuccMod, c.pmRrcConnEstabSuccMta, c.pmRrcConnEstabSuccHpa,
            c.pmRrcConnEstabAttMod, c.pmRrcConnEstabAttMta, c.pmRrcConnEstabAttHpa,
            c.pmRrcConnEstabAttReattMod, c.pmRrcConnEstabAttReattMta, c.pmRrcConnEstabAttReattHpa,
            c.pmRrcConnEstabFailMmeOvlMod,
            c.pmS1SigConnEstabSuccMod, c.pmS1SigConnEstabSuccMta, c.pmS1SigConnEstabSuccHpa,
            c.pmS1SigConnEstabAttMod, c.pmS1SigConnEstabAttMta, c.pmS1SigConnEstabAttHpa,
            c.pmErabEstabSuccInitQci1, c.pmErabEstabSuccAddedQci1,
            c.pmErabEstabAttInitQci1, c.pmErabEstabAttAddedQci1, c.pmErabEstabAttAddedHoOngoingQci1,
            c.pmErabRelAbnormalEnbQci1, c.pmErabRelAbnormalMmeQci1,
            c.pmErabRelNormalEnbQci1, c.pmErabRelMmeQci1,
            c.pmErabQciLevSum1,
            c.pmErabRelAbnormalEnbActQci1, c.pmErabRelAbnormalMmeActQci1,
            c.pmErabEstabSuccInitQci5, c.pmErabEstabSuccAddedQci5,
            c.pmErabEstabAttInitQci5, c.pmErabEstabAttAddedQci5, c.pmErabEstabAttAddedHoOngoingQci5,
            c.pmVoipQualityRbUlOk, c.pmVoipQualityRbUlNok,
            c.pmDlAssigsTransVolte, c.pmUlGrantsTransVolte, c.pmUlGrantsTransVolteNoAck,
            c.pmDlAssigsWithDetectedHarqAckVolte, c.pmUlGrantsWithDetectedPuschVolte,
            c.pmHoExeOutSuccQci1, c.pmHoExeOutAttQci1
        FROM pm_counters c
        INNER JOIN latest_records l ON 
            c.celija = l.celija AND 
            c.stanica = l.stanica AND 
            c.klaster = l.klaster AND 
            c.band = l.band AND
            c.datetime = l.latest_dt
        ORDER BY c.klaster, c.stanica, c.celija
        LIMIT %(limit)s
        """
        
        try:
            result = self.client.execute(
                query, 
                params,
                with_column_types=False
            )
            
            columns = [
                "datetime", "stanica", "celija", "klaster", "band",
                "pmRrcConnEstabSuccMod", "pmRrcConnEstabSuccMta", "pmRrcConnEstabSuccHpa",
                "pmRrcConnEstabAttMod", "pmRrcConnEstabAttMta", "pmRrcConnEstabAttHpa",
                "pmRrcConnEstabAttReattMod", "pmRrcConnEstabAttReattMta", "pmRrcConnEstabAttReattHpa",
                "pmRrcConnEstabFailMmeOvlMod",
                "pmS1SigConnEstabSuccMod", "pmS1SigConnEstabSuccMta", "pmS1SigConnEstabSuccHpa",
                "pmS1SigConnEstabAttMod", "pmS1SigConnEstabAttMta", "pmS1SigConnEstabAttHpa",
                "pmErabEstabSuccInitQci1", "pmErabEstabSuccAddedQci1",
                "pmErabEstabAttInitQci1", "pmErabEstabAttAddedQci1", "pmErabEstabAttAddedHoOngoingQci1",
                "pmErabRelAbnormalEnbQci1", "pmErabRelAbnormalMmeQci1",
                "pmErabRelNormalEnbQci1", "pmErabRelMmeQci1",
                "pmErabQciLevSum1",
                "pmErabRelAbnormalEnbActQci1", "pmErabRelAbnormalMmeActQci1",
                "pmErabEstabSuccInitQci5", "pmErabEstabSuccAddedQci5",
                "pmErabEstabAttInitQci5", "pmErabEstabAttAddedQci5", "pmErabEstabAttAddedHoOngoingQci5",
                "pmVoipQualityRbUlOk", "pmVoipQualityRbUlNok",
                "pmDlAssigsTransVolte", "pmUlGrantsTransVolte", "pmUlGrantsTransVolteNoAck",
                "pmDlAssigsWithDetectedHarqAckVolte", "pmUlGrantsWithDetectedPuschVolte",
                "pmHoExeOutSuccQci1", "pmHoExeOutAttQci1"
            ]
            
            rows = []
            for row in result:
                row_dict = dict(zip(columns, row))
                if isinstance(row_dict['datetime'], str):
                    row_dict['datetime'] = datetime.strptime(
                        str(row_dict['datetime']), 
                        "%Y-%m-%d %H:%M:%S"
                    )
                rows.append(row_dict)
            
            logger.info(f"Fetched {len(rows)} latest PM counter records")
            return rows
            
        except Exception as e:
            logger.error(f"Error fetching latest KPI data: {e}")
            return []
    
    def get_aggregated_kpi(
        self, 
        group_by: str = "cluster",
        hours: int = 24
    ) -> List[Dict[str, Any]]:
        """
        Get aggregated KPI data by specified field
        
        Args:
            group_by: Field to group by (cluster, station, band, hour)
            hours: Time range in hours
            
        Returns:
            List of aggregated KPI dictionaries
        """
        self.connect()
        
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        valid_group_by = ["cluster", "stanica", "band", "celija"]
        if group_by not in valid_group_by:
            group_by = "cluster"
        
        # Use the KPI calculation formulas directly in SQL
        # This is simplified - actual calculation should be done in Python
        # for consistency with C++ calculator
        query = f"""
        SELECT 
            {group_by},
            count(*) as cell_count,
            avg(volteAccessFailureRate) as avg_access_fail_rate,
            avg(volteDropRate) as avg_drop_rate,
            avg(volteCellIntegrity) as avg_cell_integrity,
            sum(volteErlang) as total_erlang,
            sum(volteSuccCalls) as total_success_calls,
            sum(volteDropsCount) as total_drops_count
        FROM (
            SELECT 
                celija, stanica, klaster, band,
                -- Calculate KPIs inline (simplified)
                0 as volteAccessFailureRate,
                0 as volteDropRate,
                0 as volteCellIntegrity,
                pmErabQciLevSum1 / 720.0 as volteErlang,
                pmErabEstabSuccInitQci1 + pmErabEstabSuccAddedQci1 as volteSuccCalls,
                pmErabRelAbnormalEnbActQci1 + pmErabRelAbnormalMmeActQci1 as volteDropsCount
            FROM pm_counters
            WHERE datetime >= %(start_time)s AND datetime <= %(end_time)s
        ) subq
        GROUP BY {group_by}
        ORDER BY cell_count DESC
        """
        
        try:
            result = self.client.execute(
                query,
                {"start_time": start_time, "end_time": end_time},
                with_column_types=False
            )
            
            columns = [group_by, "cell_count", "avg_access_fail_rate", 
                      "avg_drop_rate", "avg_cell_integrity", "total_erlang",
                      "total_success_calls", "total_drops_count"]
            
            rows = []
            for row in result:
                rows.append(dict(zip(columns, row)))
            
            return rows
            
        except Exception as e:
            logger.error(f"Error fetching aggregated KPI data: {e}")
            return []
    
    def get_table_schema(self) -> List[Dict[str, Any]]:
        """Get the schema of the pm_counters table"""
        self.connect()
        
        query = """
        SELECT name, type
        FROM system.columns
        WHERE database = %(database)s AND table = 'pm_counters'
        ORDER BY position
        """
        
        try:
            result = self.client.execute(
                query,
                {"database": settings.CH_DATABASE},
                with_column_types=False
            )
            return [{"name": row[0], "type": row[1]} for row in result]
        except Exception as e:
            logger.error(f"Error fetching table schema: {e}")
            return []
    
    def check_health(self) -> bool:
        """Check if database connection is healthy"""
        try:
            self.connect()
            self.client.execute("SELECT 1")
            return True
        except:
            return False


# Singleton instance
clickhouse_client = ClickHouseClient()
