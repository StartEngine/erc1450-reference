"""
Setup configuration for startengine-erc1450 package.

This package provides Python access to ERC1450 and RTAProxy smart contract
artifacts for deployment and interaction.
"""

from setuptools import setup, find_packages
import os
from pathlib import Path

# Read version from package
version_file = Path(__file__).parent / "startengine_erc1450" / "__init__.py"
version = "1.0.0"  # Default version
if version_file.exists():
    with open(version_file) as f:
        for line in f:
            if line.startswith("__version__"):
                version = line.split("=")[1].strip().strip('"').strip("'")
                break

# Read README for long description
readme_file = Path(__file__).parent / "README.md"
long_description = ""
if readme_file.exists():
    with open(readme_file, encoding="utf-8") as f:
        long_description = f.read()

setup(
    name="startengine-erc1450",
    version=version,
    author="StartEngine",
    author_email="engineering@startengine.com",
    description="Python package for ERC1450 token and RTAProxy smart contracts",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/StartEngine/erc1450-reference",
    project_urls={
        "Bug Tracker": "https://github.com/StartEngine/erc1450-reference/issues",
        "Documentation": "https://github.com/StartEngine/erc1450-reference#readme",
        "Source Code": "https://github.com/StartEngine/erc1450-reference",
    },
    packages=find_packages(exclude=["tests", "tests.*", "scripts", "contracts"]),
    include_package_data=True,
    package_data={
        "startengine_erc1450": [
            "data/artifacts/**/*.json",
        ],
    },
    install_requires=[
        "web3>=6.0.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-cov>=3.0.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
            "mypy>=0.950",
        ],
    },
    python_requires=">=3.8",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Office/Business :: Financial",
        "Topic :: System :: Distributed Computing",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Operating System :: OS Independent",
    ],
    keywords="ethereum, blockchain, erc1450, smart-contracts, web3, startengine, tokenization",
)

# Version History:
# 1.0.1 - Initial release with RTAProxy and ERC1450 support
# 1.0.1 - Bug fixes (future)
# 1.1.0 - New features (future)
# 2.0.0 - Breaking changes (future)