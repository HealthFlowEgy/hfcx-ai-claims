"""Tests for the medical code search service (ICD-10-CM + CPT)."""
from __future__ import annotations

import pytest

from src.services.code_search_service import CodeSearchService


@pytest.fixture(scope="module")
def svc() -> CodeSearchService:
    return CodeSearchService.get_instance()


def test_icd10_codes_loaded(svc: CodeSearchService) -> None:
    """Verify the full ICD-10-CM FY2026 dataset was loaded."""
    assert svc.icd10_count > 70_000, f"Expected 70k+ ICD-10 codes, got {svc.icd10_count}"


def test_cpt_codes_loaded(svc: CodeSearchService) -> None:
    """Verify CPT codes were loaded."""
    assert svc.cpt_count > 5_000, f"Expected 5k+ CPT codes, got {svc.cpt_count}"


def test_icd10_prefix_search(svc: CodeSearchService) -> None:
    """Search by ICD-10 code prefix returns matching codes."""
    results = svc.search("J06", code_type="icd10", limit=10)
    assert len(results) > 0
    assert all(r["code"].startswith("J06") for r in results)


def test_icd10_exact_match(svc: CodeSearchService) -> None:
    """Exact ICD-10 code match returns the code first."""
    results = svc.search("J06.9", code_type="icd10", limit=5)
    assert len(results) > 0
    assert results[0]["code"] == "J06.9"


def test_icd10_description_search(svc: CodeSearchService) -> None:
    """Search by description substring returns relevant codes."""
    results = svc.search("diabetes", code_type="icd10", limit=10)
    assert len(results) > 0
    assert any("diabet" in r["description"].lower() for r in results)


def test_cpt_prefix_search(svc: CodeSearchService) -> None:
    """Search by CPT code prefix returns matching codes."""
    results = svc.search("992", code_type="cpt", limit=10)
    assert len(results) > 0
    assert all(r["code"].startswith("992") for r in results)


def test_cpt_description_search(svc: CodeSearchService) -> None:
    """Search CPT by procedure description returns results."""
    results = svc.search("office", code_type="cpt", limit=10)
    assert len(results) > 0


def test_cpt_result_has_description(svc: CodeSearchService) -> None:
    """CPT results include procedure name descriptions."""
    results = svc.search("99213", code_type="cpt", limit=5)
    assert len(results) > 0
    assert results[0]["code"] == "99213"
    assert len(results[0]["description"]) > 0


def test_empty_query_returns_results(svc: CodeSearchService) -> None:
    """Empty query returns first N codes."""
    results = svc.search("", code_type="icd10", limit=5)
    assert len(results) == 5


def test_no_match_returns_empty(svc: CodeSearchService) -> None:
    """Non-matching query returns empty list."""
    results = svc.search("ZZZZZZZZZ", code_type="icd10", limit=5)
    assert len(results) == 0


def test_limit_respected(svc: CodeSearchService) -> None:
    """Limit parameter is respected."""
    results = svc.search("A", code_type="icd10", limit=3)
    assert len(results) <= 3
