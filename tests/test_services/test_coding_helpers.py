"""Tests for src.api.routes._coding_helpers."""
from __future__ import annotations

from src.api.routes._coding_helpers import (
    extract_icd10_code,
    extract_icd10_label,
    extract_procedure_label,
    extract_procedure_name,
)


class TestExtractIcd10Code:
    def test_none_input(self) -> None:
        assert extract_icd10_code(None) == ""

    def test_empty_dict(self) -> None:
        assert extract_icd10_code({}) == ""

    def test_empty_validations(self) -> None:
        assert extract_icd10_code({"icd10_validations": []}) == ""

    def test_returns_first_code(self) -> None:
        result = extract_icd10_code({
            "icd10_validations": [
                {"code": "J18.9", "valid": True, "description": "Pneumonia"},
                {"code": "E11.9", "valid": True, "description": "Diabetes"},
            ]
        })
        assert result == "J18.9"

    def test_skips_empty_code(self) -> None:
        result = extract_icd10_code({
            "icd10_validations": [
                {"code": "", "valid": False},
                {"code": "M54.5", "valid": True},
            ]
        })
        assert result == "M54.5"


class TestExtractIcd10Label:
    def test_none_input(self) -> None:
        assert extract_icd10_label(None) == ""

    def test_code_with_description(self) -> None:
        result = extract_icd10_label({
            "icd10_validations": [
                {"code": "J18.9", "description": "Pneumonia, unspecified organism"}
            ]
        })
        assert result == "J18.9 – Pneumonia, unspecified organism"

    def test_code_without_description(self) -> None:
        result = extract_icd10_label({
            "icd10_validations": [{"code": "J18.9"}]
        })
        assert result == "J18.9"


class TestExtractProcedureName:
    def test_none_input(self) -> None:
        assert extract_procedure_name(None) == ""

    def test_empty_dict(self) -> None:
        assert extract_procedure_name({}) == ""

    def test_returns_description(self) -> None:
        result = extract_procedure_name({
            "procedure_validations": [
                {"code": "99213", "description": "Office visit, est patient"}
            ]
        })
        assert result == "Office visit, est patient"

    def test_falls_back_to_code(self) -> None:
        result = extract_procedure_name({
            "procedure_validations": [{"code": "99213"}]
        })
        assert result == "99213"


class TestExtractProcedureLabel:
    def test_none_input(self) -> None:
        assert extract_procedure_label(None) == ""

    def test_code_with_description(self) -> None:
        result = extract_procedure_label({
            "procedure_validations": [
                {"code": "99213", "description": "Office visit"}
            ]
        })
        assert result == "99213 – Office visit"

    def test_code_only(self) -> None:
        result = extract_procedure_label({
            "procedure_validations": [{"code": "99213"}]
        })
        assert result == "99213"
