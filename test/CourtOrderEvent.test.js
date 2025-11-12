const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Court Order Event Tests", function () {
    let ERC1450, RTAProxy;
    let token, rtaProxy;
    let owner, rta1, rta2, rta3, holder1, holder2;
    const documentHash = ethers.encodeBytes32String("COURT-ORDER-2024-001");

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
            ethers.parseEther("1000"),
            REG_US_A,
            issuanceDate
        ]);
        await rtaProxy.connect(rta1).submitOperation(await token.getAddress(), mintData, 0);
        await rtaProxy.connect(rta2).confirmOperation(0);
    });

    describe("Regular ERC1450 Contract", function () {
        it("Should emit CourtOrderExecuted event with correct parameters", async function () {
            const transferAmount = ethers.parseEther("500");
            const tokenAddress = await token.getAddress();

            // Prepare court order execution
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash
            ]);

            // Submit and execute through multi-sig
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, courtOrderData, 0);

            // Get the current block timestamp for comparison
            const blockBefore = await ethers.provider.getBlock('latest');

            // This should emit the event
            const tx = await rtaProxy.connect(rta2).confirmOperation(1);
            const receipt = await tx.wait();

            // Find the CourtOrderExecuted event in the transaction
            const tokenContract = await ethers.getContractAt("ERC1450", tokenAddress);
            const eventFilter = tokenContract.filters.CourtOrderExecuted();
            const events = await tokenContract.queryFilter(eventFilter, receipt.blockNumber, receipt.blockNumber);

            expect(events.length).to.equal(1);
            const event = events[0];

            // Verify event parameters
            expect(event.args.from).to.equal(holder1.address);
            expect(event.args.to).to.equal(holder2.address);
            expect(event.args.amount).to.equal(transferAmount);
            expect(event.args.documentHash).to.equal(documentHash);
            expect(event.args.timestamp).to.be.gt(blockBefore.timestamp);

            // Verify the transfer actually happened
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });

        it("Should include documentHash in event even for frozen accounts", async function () {
            const transferAmount = ethers.parseEther("300");
            const tokenAddress = await token.getAddress();

            // Freeze holder1
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                holder1.address,
                true
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, freezeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Court order should still work
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, courtOrderData, 0);

            // Execute and check event
            await expect(rtaProxy.connect(rta2).confirmOperation(2))
                .to.emit(token, "CourtOrderExecuted")
                .withArgs(
                    holder1.address,
                    holder2.address,
                    transferAmount,
                    documentHash,
                    await ethers.provider.getBlock('latest').then(b => b.timestamp + 1)
                );
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
                ethers.parseEther("1000"),
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

        it("Should emit CourtOrderExecuted event in upgradeable contract", async function () {
            const transferAmount = ethers.parseEther("250");
            const tokenAddress = await tokenUpgradeable.getAddress();

            const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                holder1.address,
                holder2.address,
                transferAmount,
                documentHash
            ]);

            await rtaProxyUpgradeable.connect(rta1).submitOperation(tokenAddress, courtOrderData, 0);

            // Check event emission
            await expect(rtaProxyUpgradeable.connect(rta2).confirmOperation(1))
                .to.emit(tokenUpgradeable, "CourtOrderExecuted")
                .withArgs(
                    holder1.address,
                    holder2.address,
                    transferAmount,
                    documentHash,
                    await ethers.provider.getBlock('latest').then(b => b.timestamp + 1)
                );

            // Verify balance change
            expect(await tokenUpgradeable.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Document Hash Utility", function () {
        it("Should handle different document hash formats", async function () {
            const hashes = [
                ethers.encodeBytes32String("DIVORCE-2024-001"),
                ethers.encodeBytes32String("ESTATE-2024-002"),
                ethers.encodeBytes32String("SEC-ORDER-2024"),
                ethers.keccak256(ethers.toUtf8Bytes("ipfs://QmExample")),
                ethers.zeroPadValue("0x1234", 32)
            ];

            for (let i = 0; i < hashes.length; i++) {
                const amount = ethers.parseEther((10 * (i + 1)).toString());

                const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                    holder1.address,
                    holder2.address,
                    amount,
                    hashes[i]
                ]);

                await rtaProxy.connect(rta1).submitOperation(
                    await token.getAddress(),
                    courtOrderData,
                    0
                );

                const tx = await rtaProxy.connect(rta2).confirmOperation(i + 1);
                const receipt = await tx.wait();

                // Verify each hash is properly recorded
                const tokenContract = await ethers.getContractAt("ERC1450", await token.getAddress());
                const events = await tokenContract.queryFilter(
                    tokenContract.filters.CourtOrderExecuted(),
                    receipt.blockNumber,
                    receipt.blockNumber
                );

                expect(events[0].args.documentHash).to.equal(hashes[i]);
            }
        });
    });
});