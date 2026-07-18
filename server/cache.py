"""
Redis Cache Module
Handles caching of KPI data to reduce database load
"""

import json
import hashlib
from typing import Optional, Any, Dict
from functools import wraps
from datetime import timedelta
import logging

from .config import settings, REDIS_URL

logger = logging.getLogger(__name__)

# Try to import redis, provide fallback if not available
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("Redis not available, caching disabled")


class CacheClient:
    """Redis cache client with fallback to in-memory cache"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.memory_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl: int = settings.CACHE_TTL
        
        if REDIS_AVAILABLE and settings.REDIS_HOST:
            try:
                self.redis_client = redis.Redis(
                    host=settings.REDIS_HOST,
                    port=settings.REDIS_PORT,
                    password=settings.REDIS_PASSWORD if settings.REDIS_PASSWORD else None,
                    decode_responses=True,
                    socket_timeout=10,
                    socket_connect_timeout=10
                )
                # Test connection
                self.redis_client.ping()
                logger.info(f"Connected to Redis at {REDIS_URL}")
            except Exception as e:
                logger.warning(f"Failed to connect to Redis: {e}, using in-memory cache")
                self.redis_client = None
    
    def _generate_key(self, prefix: str, *args, **kwargs) -> str:
        """Generate cache key from prefix and parameters"""
        # Sort kwargs for consistent key generation
        sorted_kwargs = sorted(kwargs.items())
        key_str = f"{prefix}:{args}:{sorted_kwargs}"
        return f"kpi:{hashlib.md5(key_str.encode()).hexdigest()}"
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        if self.redis_client:
            try:
                cached = self.redis_client.get(key)
                if cached:
                    return json.loads(cached)
            except Exception as e:
                logger.error(f"Redis get error: {e}")
        
        # Fallback to memory cache
        if key in self.memory_cache:
            cached = self.memory_cache[key]
            if cached.get("expires_at", 0) > 0:
                return cached.get("value")
            else:
                del self.memory_cache[key]
        
        return None
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set value in cache"""
        if ttl is None:
            ttl = self.cache_ttl
        
        if self.redis_client:
            try:
                self.redis_client.setex(key, ttl, json.dumps(value))
            except Exception as e:
                logger.error(f"Redis set error: {e}")
        
        # Also set in memory cache
        expires_at = timedelta(seconds=ttl).total_seconds()
        self.memory_cache[key] = {
            "value": value,
            "expires_at": expires_at
        }
    
    def delete(self, key: str):
        """Delete value from cache"""
        if self.redis_client:
            try:
                self.redis_client.delete(key)
            except Exception as e:
                logger.error(f"Redis delete error: {e}")
        
        if key in self.memory_cache:
            del self.memory_cache[key]
    
    def clear(self):
        """Clear all cache"""
        if self.redis_client:
            try:
                self.redis_client.flushdb()
            except Exception as e:
                logger.error(f"Redis flush error: {e}")
        
        self.memory_cache.clear()
    
    def cached(self, prefix: str, ttl: Optional[int] = None):
        """Decorator for caching function results"""
        def decorator(func):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                cache_key = self._generate_key(prefix, *args, **kwargs)
                
                # Try to get from cache
                cached_result = self.get(cache_key)
                if cached_result is not None:
                    logger.debug(f"Cache hit for {prefix}")
                    return cached_result
                
                # Execute function
                logger.debug(f"Cache miss for {prefix}, executing function")
                result = await func(*args, **kwargs)
                
                # Store in cache
                if result is not None:
                    self.set(cache_key, result, ttl)
                
                return result
            
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                cache_key = self._generate_key(prefix, *args, **kwargs)
                
                # Try to get from cache
                cached_result = self.get(cache_key)
                if cached_result is not None:
                    logger.debug(f"Cache hit for {prefix}")
                    return cached_result
                
                # Execute function
                logger.debug(f"Cache miss for {prefix}, executing function")
                result = func(*args, **kwargs)
                
                # Store in cache
                if result is not None:
                    self.set(cache_key, result, ttl)
                
                return result
            
            # Return sync wrapper if function is sync, async wrapper if async
            import inspect
            if inspect.iscoroutinefunction(func):
                return wrapper
            else:
                return sync_wrapper
        
        return decorator


# Singleton instance
cache_client = CacheClient()
