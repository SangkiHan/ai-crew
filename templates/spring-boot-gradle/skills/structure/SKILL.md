---
name: Project Structure
description: Guide for Project Structure.
---
# Guide for Project Structure

## Overview
Project structure plays a crucial role in enhancing the maintainability and scalability of a project. A proper structure allows developers to easily understand and modify code, and facilitates the addition of new features.

## When to use?
- When the user modifies code or adds a new feature.
- When a feature addition is requested.
- When a feature modification is requested.

## Project Structure Implementation Guidelines
- Structure the project by dividing packages by domain under the base package (e.g., `src/main/java/com/example/project`). For example, user-related code should be in the `user` package, and post-related code in the `post` package.
- It is advisable to separate concerns by placing classes including domain models, services, and controllers within each package. For example, the `user` package may include the `User` entity, `UserService`, and `UserController`.
- Additionally, commonly used utility classes or exception handling classes should be placed in the `global` package. This makes the project structure clear and helps developers easily find the necessary code.
- Configurations are recommended to be placed in the `global/config` package. For example, database settings, security configurations, and Swagger settings can be included in the config package.
- It is recommended to create and manage Request DTOs and Response DTOs for each Controller, Service, and Repository to clarify API specifications and improve maintainability. However, the Controller shares the Response with the Service.
- When converting requests to different layers, it is recommended to create and manage `toServiceRequest()` and `toDto()` methods. This reduces dependencies between layers and enhances code readability.
- When creating a Response, it is recommended to use the `of()` method. This makes object creation clear and maintains code consistency. For example, creating an `of()` method in the `UserResponse` class to convert a `User` entity into a `UserResponse`.
