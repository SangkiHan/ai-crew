---
name: Restdocs
description: Restdocs Test Code Writing Guide
---
# Restdocs Test Code Writing Guide

## Overview
This is a guide on how to write test codes using JUnit when creating unit tests for each layer, such as Controller, Service, and Repository.

## When to use?
- When the user requests to write Restdocs test codes.
- When the user requests to add a feature.
- When a bug occurs.
- When the user requests to modify a feature.

## How to write Restdocs test codes
- Write Controller specifications under the test/java/docs folder.
- Match the package structure to be identical to the actual Controller's package structure.
- Test the Service layer by mocking it using MockBean.
- Write API specifications in the src/docs/asciidoc folder.
- Write API specifications to be identical to the actual API specifications.
