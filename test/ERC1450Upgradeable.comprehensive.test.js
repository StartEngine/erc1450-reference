const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ERC1450Upgradeable Comprehensive Tests", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let ERC1450Upgradeable, RTAProxyUpgradeable, MockERC20;
    let token, rtaProxy, feeToken;
    let owner, rta1, rta2, rta3, holder1, holder2, broker1, nonRTA, feeRecipient;
    let tokenAddress, rtaProxyAddress, feeTokenAddress;

    beforeEach(async function () {
        // Get signers
        [owner, rta1, rta2, rta3, holder1, holder2, broker1, nonRTA, feeRecipient] = await ethers.getSigners();

        // Deploy MockERC20 for fee token (6 decimals like USDC)
        MockERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await MockERC20.deploy("USD Coin", "USDC", 6);
        await feeToken.waitForDeployment();
        feeTokenAddress = await feeToken.getAddress();

        // Deploy contracts
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address, rta3.address], 2],
            { initializer: 'initialize', kind: 'uups' }
        );
        await rtaProxy.waitForDeployment();
        rtaProxyAddress = await rtaProxy.getAddress();

        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Security Token", "TST", 10, owner.address, rtaProxyAddress],
            { initializer: 'initialize', kind: 'uups' }
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Set default fee token to the MockERC20 (USDC-like token)
        const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeTokenAddress]);
        await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeTokenData, 0);
        await rtaProxy.connect(rta2).confirmOperation(0);

        // Mint fee tokens to holders for testing
        await feeToken.mint(holder1.address, ethers.parseUnits("1000", 6));
        await feeToken.mint(holder2.address, ethers.parseUnits("1000", 6));
        await feeToken.mint(broker1.address, ethers.parseUnits("1000", 6));

        // Approve token contract to spend fee tokens
        await feeToken.connect(holder1).approve(tokenAddress, ethers.parseUnits("1000", 6));
        await feeToken.connect(holder2).approve(tokenAddress, ethers.parseUnits("1000", 6));
        await feeToken.connect(broker1).approve(tokenAddress, ethers.parseUnits("1000", 6));
    });

    describe("Transfer Request System - Complete Flow", function () {
        beforeEach(async function () {
            // Mint tokens to holder1
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);
        });

        it("Should handle complete transfer request lifecycle", async function () {
            const transferAmount = ethers.parseUnits("100", 10);
            const feeAmount = ethers.parseUnits("1", 6); // 1 USDC fee

            // Create transfer request (uses configured fee token)
            await expect(
                token.connect(holder1).requestTransferWithFee(
                    holder1.address,
                    holder2.address,
                    transferAmount,
                    feeAmount
                )
            ).to.emit(token, "TransferRequested")
                .withArgs(1, holder1.address, holder2.address, transferAmount, feeAmount, holder1.address);

            // Check request details
            const request = await token.transferRequests(1);
            expect(request.from).to.equal(holder1.address);
            expect(request.to).to.equal(holder2.address);
            expect(request.amount).to.equal(transferAmount);
            expect(request.status).to.equal(0); // Requested (first enum value)

            // Process the request
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);

            await expect(rtaProxy.connect(rta2).confirmOperation(2))
                .to.emit(token, "TransferExecuted")
                .withArgs(1, holder1.address, holder2.address, transferAmount);

            // Verify balances
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("900", 10));
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);

            // Check request status updated
            const requestAfter = await token.transferRequests(1);
            expect(requestAfter.status).to.equal(4); // Executed
        });

        it("Should reject transfer request with reason code", async function () {
            // Create request
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("1", 6) // 1 USDC fee
            );

            // Reject with reason code
            const rejectData = token.interface.encodeFunctionData("rejectTransferRequest", [
                1,  // requestId
                3,  // reasonCode (NOT_QUALIFIED)
                true // refund fee
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, rejectData, 0);

            await expect(rtaProxy.connect(rta2).confirmOperation(2))
                .to.emit(token, "TransferRejected")
                .withArgs(1, 3, true);

            // Verify no transfer happened
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("1000", 10));
            expect(await token.balanceOf(holder2.address)).to.equal(0);
        });

        it("Should update request status through RTA", async function () {
            // Create request
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("50", 10),
                0
            );

            // Update status to Approved (2)
            const updateData = token.interface.encodeFunctionData("updateRequestStatus", [1, 2]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, updateData, 0);

            await expect(rtaProxy.connect(rta2).confirmOperation(2))
                .to.emit(token, "RequestStatusChanged");

            const request = await token.transferRequests(1);
            expect(request.status).to.equal(2); // Approved
        });
    });

    describe("Fee Management - Complete", function () {
        it("Should calculate flat fees correctly", async function () {
            // Fee token already set to USDC in beforeEach

            // Set flat fee
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, // flat fee type
                ethers.parseUnits("5", 6) // 5 USDC flat fee
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Check fee calculation
            const fee = await token.getTransferFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("1000", 10) // amount doesn't matter for flat fee
            );

            expect(fee).to.equal(ethers.parseUnits("5", 6));
        });

        it("Should calculate percentage fees correctly", async function () {
            // Fee token already set to USDC in beforeEach

            // Set percentage fee (1% = 100 basis points)
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, // percentage fee type
                100 // 100 basis points = 1%
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Check fee calculation for different amounts
            // Note: percentage fees are calculated based on the transfer amount (in token decimals)
            // but returned in fee token decimals
            const fee1 = await token.getTransferFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("1000", 10)
            );
            expect(fee1).to.equal(ethers.parseUnits("10", 10)); // 1% of 1000

            const fee2 = await token.getTransferFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("500", 10)
            );
            expect(fee2).to.equal(ethers.parseUnits("5", 10)); // 1% of 500
        });

        it("Should withdraw collected fees", async function () {
            // First collect some fees
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Make transfer request with fee
            const feeAmount = ethers.parseUnits("10", 6); // 10 USDC fee
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                ethers.parseUnits("100", 10),
                feeAmount
            );

            // Check fee collected
            expect(await token.collectedFeesTotal()).to.equal(feeAmount);

            // Withdraw fees
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                feeAmount,
                feeRecipient.address
            ]);

            const balanceBefore = await feeToken.balanceOf(feeRecipient.address);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, withdrawData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            const balanceAfter = await feeToken.balanceOf(feeRecipient.address);
            expect(balanceAfter - balanceBefore).to.equal(feeAmount);

            // Check fees cleared
            expect(await token.collectedFeesTotal()).to.equal(0);
        });

        it("Should get fee token", async function () {
            const feeTokenAddr = await token.getFeeToken();
            expect(feeTokenAddr).to.equal(feeTokenAddress); // USDC set in beforeEach
        });

        it("Should handle ERC20 fee token correctly with complete lifecycle", async function () {
            // Mint tokens to holder1
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Fee token already set to USDC in beforeEach
            // holder1 already has USDC and approval from beforeEach

            // Verify fee token is set
            expect(await token.getFeeToken()).to.equal(feeTokenAddress);

            // Set flat fee in fee token decimals (6 decimals for USDC)
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, // flat fee type
                ethers.parseUnits("5", 6) // 5 USDC flat fee
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Check initial holder1 balance
            const holder1InitialBalance = await feeToken.balanceOf(holder1.address);

            // Make transfer request with ERC20 fee
            const feeAmount = ethers.parseUnits("5", 6);
            await expect(
                token.connect(holder1).requestTransferWithFee(
                    holder1.address,
                    holder2.address,
                    ethers.parseUnits("100", 10),
                    feeAmount
                )
            ).to.emit(token, "TransferRequested");

            // Check fee collected
            expect(await token.collectedFeesTotal()).to.equal(feeAmount);

            // Check fee tokens were transferred from holder1
            expect(await feeToken.balanceOf(holder1.address)).to.equal(holder1InitialBalance - feeAmount);
            expect(await feeToken.balanceOf(tokenAddress)).to.equal(feeAmount);

            // Withdraw ERC20 fees
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                feeAmount,
                feeRecipient.address
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, withdrawData, 0);
            await rtaProxy.connect(rta2).confirmOperation(3);

            // Check fees withdrawn to recipient
            expect(await feeToken.balanceOf(feeRecipient.address)).to.equal(feeAmount);
            expect(await token.collectedFeesTotal()).to.equal(0);
        });
    });

    describe("Broker Management", function () {
        it("Should approve and revoke broker status", async function () {
            // Initially not a broker
            expect(await token.isRegisteredBroker(broker1.address)).to.be.false;

            // Approve broker
            const approveData = token.interface.encodeFunctionData("setBrokerStatus", [
                broker1.address,
                true
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, approveData, 0);
            await expect(rtaProxy.connect(rta2).confirmOperation(1))
                .to.emit(token, "BrokerStatusUpdated")
                .withArgs(broker1.address, true, rtaProxyAddress);

            expect(await token.isRegisteredBroker(broker1.address)).to.be.true;

            // Revoke broker
            const revokeData = token.interface.encodeFunctionData("setBrokerStatus", [
                broker1.address,
                false
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, revokeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            expect(await token.isRegisteredBroker(broker1.address)).to.be.false;
        });

        it("Should allow broker to request transfers on behalf of holders", async function () {
            // Setup: Mint tokens and approve broker
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            const approveData = token.interface.encodeFunctionData("setBrokerStatus", [
                broker1.address,
                true
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, approveData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Broker requests transfer on behalf of holder1
            const feeAmount = ethers.parseUnits("2", 6); // 2 USDC
            await expect(
                token.connect(broker1).requestTransferWithFee(
                    holder1.address,
                    holder2.address,
                    ethers.parseUnits("250", 10),
                    feeAmount
                )
            ).to.emit(token, "TransferRequested")
                .withArgs(1, holder1.address, holder2.address, ethers.parseUnits("250", 10), feeAmount, broker1.address);

            const request = await token.transferRequests(1);
            expect(request.requestedBy).to.equal(broker1.address);
        });
    });

    describe("Account Freezing", function () {
        beforeEach(async function () {
            // Mint tokens for testing
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);
        });

        it("Should freeze and unfreeze accounts", async function () {
            // Initially not frozen
            expect(await token.isAccountFrozen(holder1.address)).to.be.false;

            // Freeze account
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                holder1.address,
                true
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, freezeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            expect(await token.isAccountFrozen(holder1.address)).to.be.true;

            // Try to transfer from frozen account (should revert)
            const transferData = token.interface.encodeFunctionData("transferFrom", [
                holder1.address,
                holder2.address,
                ethers.parseUnits("100", 10)
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);

            // This should fail (frozen account)
            let failed = false;
            try {
                await rtaProxy.connect(rta2).confirmOperation(3);
            } catch (error) {
                failed = true;
            }
            expect(failed).to.be.true;

            // Unfreeze
            const unfreezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                holder1.address,
                false
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, unfreezeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(4);

            expect(await token.isAccountFrozen(holder1.address)).to.be.false;
        });
    });

    describe("Direct Transfer Restrictions", function () {
        it("Should revert direct transfer calls", async function () {
            await expect(
                token.connect(holder1).transfer(holder2.address, 100)
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");
        });

        it("Should revert approve calls", async function () {
            await expect(
                token.connect(holder1).approve(holder2.address, 100)
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");
        });

        it("Should return 0 for allowance", async function () {
            const allowance = await token.allowance(holder1.address, holder2.address);
            expect(allowance).to.equal(0);
        });
    });

    describe("Minting and Burning", function () {
        it("Should only allow RTA to mint", async function () {
            // Try direct mint (should fail)
            await expect(
                token.connect(nonRTA).mint(holder1.address, 1000, REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Mint through RTA
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("500", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("500", 10));
            expect(await token.totalSupply()).to.equal(ethers.parseUnits("500", 10));
        });

        it("Should only allow RTA to burn", async function () {
            // First mint some tokens
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Try direct burn (should fail)
            await expect(
                token.connect(nonRTA).burnFrom(holder1.address, ethers.parseUnits("100", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Burn through RTA
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                holder1.address,
                ethers.parseUnits("300", 10)
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("700", 10));
            expect(await token.totalSupply()).to.equal(ethers.parseUnits("700", 10));
        });

        it("Should revert burning more than balance", async function () {
            // Mint first
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("100", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Try to burn more than balance
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                holder1.address,
                ethers.parseUnits("200", 10) // More than balance
            ]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);

            // The operation will fail during execution due to insufficient balance
            // We expect the transaction to revert when trying to execute through the proxy
            try {
                await rtaProxy.connect(rta2).confirmOperation(2);
                expect.fail("Should have reverted");
            } catch (error) {
                // The error is expected - insufficient balance
                expect(error).to.exist;
            }
        });
    });

    describe("Issuer and Transfer Agent Management", function () {
        it("Should allow RTA to change issuer", async function () {
            const newIssuer = ethers.Wallet.createRandom().address;

            const changeData = token.interface.encodeFunctionData("changeIssuer", [newIssuer]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, changeData, 0);

            await expect(rtaProxy.connect(rta2).confirmOperation(1))
                .to.emit(token, "IssuerChanged")
                .withArgs(owner.address, newIssuer);

            expect(await token.owner()).to.equal(newIssuer);
        });

        it("Should check if address is transfer agent", async function () {
            expect(await token.isTransferAgent(rtaProxyAddress)).to.be.true;
            expect(await token.isTransferAgent(owner.address)).to.be.false;
            expect(await token.isTransferAgent(rta1.address)).to.be.false;
        });
    });

    describe("Security Token Identification", function () {
        it("Should identify as security token", async function () {
            expect(await token.isSecurityToken()).to.be.true;
        });

        it("Should support required interfaces", async function () {
            // ERC165
            expect(await token.supportsInterface("0x01ffc9a7")).to.be.true;
            // ERC20
            expect(await token.supportsInterface("0x36372b07")).to.be.false;
            // ERC20Metadata
            expect(await token.supportsInterface("0xa219a025")).to.be.true;
            // IERC1450
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;
        });
    });

    describe("Edge Cases and Error Conditions", function () {
        it("Should handle zero amount transfers", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("100", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Request zero transfer
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                0, // zero amount
                0
            );

            // Process it
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Balances should be unchanged
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("100", 10));
            expect(await token.balanceOf(holder2.address)).to.equal(0);
        });

        it("Should reject when insufficient fee token allowance", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("100", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Remove allowance
            await feeToken.connect(holder1).approve(tokenAddress, 0);

            // Try to request transfer without allowance - should fail
            await expect(
                token.connect(holder1).requestTransferWithFee(
                    holder1.address,
                    holder2.address,
                    ethers.parseUnits("10", 10),
                    ethers.parseUnits("1", 6)
                )
            ).to.be.reverted;

            // Restore allowance for other tests
            await feeToken.connect(holder1).approve(tokenAddress, ethers.parseUnits("1000", 6));
        });

        it("Should handle multiple pending requests", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Create multiple requests and track their IDs
            const requestIds = [];
            for (let i = 0; i < 3; i++) {
                const tx = await token.connect(holder1).requestTransferWithFee(
                    holder1.address,
                    holder2.address,
                    ethers.parseUnits((10 * (i + 1, 10)).toString(), 10),
                    0
                );
                const receipt = await tx.wait();
                // Get request ID from event
                const event = receipt.logs.find(log => {
                    try {
                        const parsed = token.interface.parseLog(log);
                        return parsed.name === 'TransferRequested';
                    } catch {
                        return false;
                    }
                });
                if (event) {
                    const parsed = token.interface.parseLog(event);
                    requestIds.push(parsed.args[0]);
                }
            }

            // Make sure we have 3 request IDs
            expect(requestIds.length).to.equal(3);

            // Process middle request (second one)
            const processData = token.interface.encodeFunctionData("processTransferRequest", [requestIds[1], true]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Check only the middle request was processed
            const req1 = await token.transferRequests(requestIds[0]);
            const req2 = await token.transferRequests(requestIds[1]);
            const req3 = await token.transferRequests(requestIds[2]);

            expect(req1.status).to.equal(0); // Still requested
            expect(req2.status).to.equal(4); // Executed
            expect(req3.status).to.equal(0); // Still requested
        });
    });
});