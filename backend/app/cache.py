"""Thread-safe LRU cache used for repeated identical predictions."""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """Bounded least-recently-used mapping with hit/miss counters.

    A capacity of 0 disables caching (every ``get`` misses, ``put`` is a no-op).
    """

    def __init__(self, capacity: int) -> None:
        if capacity < 0:
            raise ValueError("capacity must be >= 0")
        self.capacity = capacity
        self.hits = 0
        self.misses = 0
        self._data: OrderedDict[K, V] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: K) -> V | None:
        with self._lock:
            try:
                value = self._data[key]
            except KeyError:
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return value

    def put(self, key: K, value: V) -> None:
        if self.capacity == 0:
            return
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.capacity:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self.hits = 0
            self.misses = 0

    def __len__(self) -> int:
        return len(self._data)

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"capacity": self.capacity, "size": len(self._data), "hits": self.hits, "misses": self.misses}
