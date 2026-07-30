# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 이 파일은 ai-crew의 기본 Spring Boot 템플릿에서 자동으로 채워졌습니다. "Project Overview"와
> "Domain Modules"는 실제 프로젝트에 맞게 직접 채워주세요 - 여기서는 어떤 프로젝트에나 적용되는
> 공통 아키텍처 규칙만 담고 있습니다.

## Build & Test Commands

```bash
# Build
./gradlew build

# Run tests
./gradlew test

# Run a single test class
./gradlew test --tests "com.example.ClassName"

# Run application (dev profile)
./gradlew bootRun --args='--spring.profiles.active=dev'

# Generate REST API documentation
./gradlew asciidoctor
```

## Architecture

### Layered Pattern (per domain)

```
Controller (API entry) → Service (business logic) → Repository (data access)
```

Each domain follows this strict structure with its own packages:
- `controller/` + `controller/request/` — API layer, input validation with `@Valid`
- `service/` + `service/request/` + `service/response/` — business logic layer
- `repository/` — data access layer

### Key Architectural Rules

1. **Request conversion**: Controller requests must have a `toServiceRequest()` method to convert to service-layer DTOs before passing to the service.

2. **Entity conversion**: Service requests must have a `toEntity()` method to convert to JPA entities. The service layer calls `request.toEntity()` — never calls individual getters on a service request to construct an entity.

3. **User identity**: Never pass `userId` directly from the controller. In the service layer, always use a security/auth service to get the current user.

4. **Cross-service access**: A service can only call its own repository. To access another domain's data, call that domain's service — never reach into another domain's repository directly.

5. **Language**: Comments and log/error messages are written in Korean.

### API Response Format

All responses are wrapped in `ApiResponse<T>`:
```json
{
  "statusCode": 200,
  "httpStatus": "OK",
  "message": "OK",
  "data": { ... }
}
```

### Test Base Classes

- `ControllerTestSupport` — base for `@WebMvcTest` controller tests
- `IntegrationTestSupport` — base for full integration tests
- `RestDocsSupport` — base for Spring REST Docs API documentation tests
