cmake_minimum_required(VERSION 3.12)
project(nsga_balancer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Python 3.10 REQUIRED COMPONENTS Interpreter Development)
find_package(pybind11 CONFIG REQUIRED)

set(SOURCES
    nsga_engine.cpp
    pybind11_bindings.cpp
)

pybind11_add_module(_core MODULE ${SOURCES})

install(TARGETS _core DESTINATION nsga_balancer)
install(FILES nsga_balancer/__init__.py DESTINATION nsga_balancer)

target_link_libraries(_core PRIVATE Python::Python)

if(MSVC)
    target_compile_options(_core PRIVATE /O2 /Oi /Ot /GL)
else()
    target_compile_options(_core PRIVATE -O3 -march=native)
endif()

if(NOT MSVC)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(_core PRIVATE -flto)
    endif()
endif()
