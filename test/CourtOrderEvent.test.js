const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Controller Transfer (ERC-1644) Event Tests", function () {
    let ERC1450, RTAProxy;
    let token, rtaProxy;
    let owner, rta1, rta2, rta3, holder1, holder2;

    // ERC-1644 compatible data
    const documentHash = ethers.keccak256(ethers.toUtf8Bytes("COURT-ORDER-2024-001"));
    const operatorData = ethers.toUtf8Bytes("COURT_ORDER");

    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    beforeEach(async function () {
        [owner, rta1, rta2, rta3, holder1, holder2] = await ethers.getSigners();

        // Deploy regular contracts
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address, rta3.address], 2);
        await rtaProxy.waitForDeployment();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Test Token",
            "TST",
            18,
            owner.address,
            await rtaProxy.getAddress()
        );
        await token.waitForDeployment();

        // Mint tokens to holder1
        const mintData = token.interface.encodeFunctionData("mint", [
            holder1.address,
            ethers.parseUnits("1000", 10),
            REG_US_A,
            issuanceDate
        ]);
        await rtaProxy.connect(rta1).submitOperation(await token.getAddress(), mintData, 0);
        await rtaProxy.connect(rta2).confirmOperation(0);
    });

    describe("Regular ERC1450 Contract", function () {
        it("Should emit ControllerTransfer event with correct parameters", async function () {
            const transferAmount = ethers.parseUnits("500", 10);
            const tokenAddress = await token.getAddress();
            const rtaProxyAddress = await rtaProxy.getAddress();

            // Prepare controller transfer execution
            const controllerData = token.interface.encodeFunctionData("controllerTransfer", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash,
                operatorData
            ]);

            // Submit and execute through multi-sig
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, controllerData, 0);

            // This should emit the event
            const tx = await rtaProxy.connect(rta2).confirmOperation(1);
            const receipt = await tx.wait();

            // Find the ControllerTransfer event in the transaction
            const tokenContract = await ethers.getContractAt("ERC1450", tokenAddress);
            const eventFilter = tokenContract.filters.ControllerTransfer();
            const events = await tokenContract.queryFilter(eventFilter, receipt.blockNumber, receipt.blockNumber);

            expect(events.length).to.equal(1);
            const event = events[0];

            // Verify event parameters (ERC-1644 format)
            expect(event.args.controller).to.equal(rtaProxyAddress);
            expect(event.args.from).to.equal(holder1.address);
            expect(event.args.to).to.equal(holder2.address);
            expect(event.args.value).to.equal(transferAmount);
            expect(event.args.data).to.equal(documentHash);
            expect(ethers.toUtf8String(event.args.operatorData)).to.equal("COURT_ORDER");

            // Verify the transfer actually happened
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });

        it("Should include data in event even for frozen accounts", async function () {
            const transferAmount = ethers.parseUnits("300", 10);
            const tokenAddress = await token.getAddress();

            // Freeze holder1
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                holder1.address,
                true
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, freezeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Controller transfer should still work (bypasses freeze)
            const controllerData = token.interface.encodeFunctionData("controllerTransfer", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash,
                operatorData
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, controllerData, 0);

            // Execute and verify transfer happened
            await rtaProxy.connect(rta2).confirmOperation(2);
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Upgradeable ERC1450 Contract", function () {
        let tokenUpgradeable, rtaProxyUpgradeable;

        beforeEach(async function () {
            // Deploy upgradeable contracts
            const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
            rtaProxyUpgradeable = await upgrades.deployProxy(
                RTAProxyUpgradeable,
                [[rta1.address, rta2.address, rta3.address], 2],
                { initializer: 'initialize', kind: 'uups' }
            );
            await rtaProxyUpgradeable.waitForDeployment();

            const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
            tokenUpgradeable = await upgrades.deployProxy(
                ERC1450Upgradeable,
                [
                    "Upgradeable Token",
                    "UTST",
                    18,
                    owner.address,
                    await rtaProxyUpgradeable.getAddress()
                ],
                { initializer: 'initialize', kind: 'uups' }
            );
            await tokenUpgradeable.waitForDeployment();

            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                holder1.address,
                ethers.parseUnits("1000", 10),
                REG_US_A,
                issuanceDate
            ]);
            await rtaProxyUpgradeable.connect(rta1).submitOperation(
                await tokenUpgradeable.getAddress(),
                mintData,
                0
            );
            await rtaProxyUpgradeable.connect(rta2).confirmOperation(0);
        });

        it("Should emit ControllerTransfer event in upgradeable contract", async function () {
            const transferAmount = ethers.parseUnits("250", 10);
            const tokenAddress = await tokenUpgradeable.getAddress();
            const rtaProxyAddress = await rtaProxyUpgradeable.getAddress();

            const controllerData = tokenUpgradeable.interface.encodeFunctionData("controllerTransfer", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash,
                operatorData
            ]);

            await rtaProxyUpgradeable.connect(rta1).submitOperation(tokenAddress, controllerData, 0);

            // Execute and get receipt
            const tx = await rtaProxyUpgradeable.connect(rta2).confirmOperation(1);
            const receipt = await tx.wait();

            // Find the ControllerTransfer event
            const tokenContract = await ethers.getContractAt("ERC1450Upgradeable", tokenAddress);
            const eventFilter = tokenContract.filters.ControllerTransfer();
            const events = await tokenContract.queryFilter(eventFilter, receipt.blockNumber, receipt.blockNumber);

            expect(events.length).to.equal(1);
            expect(events[0].args.controller).to.equal(rtaProxyAddress);
            expect(events[0].args.from).to.equal(holder1.address);
            expect(events[0].args.to).to.equal(holder2.address);
            expect(events[0].args.value).to.equal(transferAmount);

            // Verify balance change
            expect(await tokenUpgradeable.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Operator Data Types", function () {
        it("Should handle different operation types via operatorData", async function () {
            const operationTypes = [
                { type: "COURT_ORDER", hash: ethers.keccak256(ethers.toUtf8Bytes("divorce-settlement")) },
                { type: "REGULATORY_ACTION", hash: ethers.keccak256(ethers.toUtf8Bytes("sec-enforcement")) },
                { type: "ESTATE_DISTRIBUTION", hash: ethers.keccak256(ethers.toUtf8Bytes("probate-2024")) },
            ];

            for (let i = 0; i < operationTypes.length; i++) {
                const amount = ethers.parseUnits((10 * (i + 1)).toString(), 10);
                const opType = operationTypes[i];

                const controllerData = token.interface.encodeFunctionData("controllerTransfer", [
                    holder1.address,
                    holder2.address,
                    amount,
                    opType.hash,
                    ethers.toUtf8Bytes(opType.type)
                ]);

                await rtaProxy.connect(rta1).submitOperation(
                    await token.getAddress(),
                    controllerData,
                    0
                );

                const tx = await rtaProxy.connect(rta2).confirmOperation(i + 1);
                const receipt = await tx.wait();

                // Verify each operation type is properly recorded
                const tokenContract = await ethers.getContractAt("ERC1450", await token.getAddress());
                const events = await tokenContract.queryFilter(
                    tokenContract.filters.ControllerTransfer(),
                    receipt.blockNumber,
                    receipt.blockNumber
                );

                expect(events[0].args.data).to.equal(opType.hash);
                expect(ethers.toUtf8String(events[0].args.operatorData)).to.equal(opType.type);
            }
        });
    });
});
