---
name: junit
description: JUnit Test Code Writing Guide
---
# JUnit Test Code Writing Guide

## Overview
This is a guide on how to write test codes using JUnit when creating unit tests for each layer, such as Controller, Service, and Repository.

## When to use?
- When the user requests to write JUnit test codes.
- When the user requests to add a feature.
- When a bug occurs.
- When the user requests to modify a feature.

## How to write JUnit test codes
- Use the @DisplayName annotation on test methods to clearly indicate the purpose of the test in Korean.
- Test method names are written in Korean, with spaces separated by _.
- Write test classes for each layer.
- Parts that call external APIs are tested by mocking them in the IntegrationTestSupport class.
- When testing a Controller, Service testing is not necessary, so test by mocking in ControllerTestSupport.
- For assertions, use AssertJ; when testing, do not do them individually, but utilize contains, containsExactly, containsExactlyInAnyOrder, etc.
- Test method names are written in given_when_then format to clearly indicate the purpose of the test.
- Write test methods so that they test only one function within each method.
- Test data is created directly within the test method, or commonly required data is set up using the @BeforeEach annotation.
