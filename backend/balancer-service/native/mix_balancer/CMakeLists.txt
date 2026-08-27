cmake_minimum_required(VERSION 3.12)
project(mix_balancer LANGUAGES CXX)

# Set C++ standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find Python
find_package(Python 3.10 REQUIRED COMPONENTS Interpreter Development)

# Add pybind11
find_package(pybind11 CONFIG REQUIRED)

# Source files
set(SOURCES
    mix_balancer.cpp
    pybind11_bindings.cpp
)

# Create the extension module with underscore prefix for internal use
pybind11_add_module(_core MODULE ${SOURCES})

# For scikit-build-core, tell it to install in the mix_balancer package
install(TARGETS _core DESTINATION mix_balancer)

# Install the __init__.py file
install(FILES mix_balancer/__init__.py DESTINATION mix_balancer)

# Link Python libraries
target_link_libraries(_core PRIVATE Python::Python)

# Set compile flags for optimization
if(MSVC)
    target_compile_options(_core PRIVATE /O2 /Oi /Ot /GL)
else()
    target_compile_options(_core PRIVATE -O3 -march=native)
endif()

# NOTE: LTO deliberately NOT enabled. It was on both here (-flto compile
# flag) and via CMAKE_INTERPROCEDURAL_OPTIMIZATION in pyproject.toml, and
# together they produced link-time GCC bugs (pybind11's link step doesn't
# pick up the matching LTO flags): "undefined symbol:
# _ZTVN10__cxxabiv117__class_type_infoE" (missing C++ RTTI typeinfo/vtable
# symbols) on the target deployment toolchain. -O3 alone already covers the
# overwhelming majority of the available speedup for a search this small;
# not worth the fragility.

# For scikit-build, don't set custom output directory
# It will handle the installation automatically
