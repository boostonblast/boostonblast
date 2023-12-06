import { Address, assertTransactionEIP1559, parseEther, parseGwei } from "viem";
import { boostEthABI, boosterABI, mockErc20ABI } from "../../src/gen/generated";
import { cast0x } from "../utils/utils";
import Booster from "../../out/Booster.sol/Booster.json";
import BoostETH from "../../out/BoostETH.sol/BoostEth.json";
import MockERC20 from "../../out/MockERC20.sol/MockERC20.json";
import { test, describe, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { anvilFork, walletClient, publicClient, testClient } from "../utils/common";

describe("Booster Tests", { concurrency: false }, async () => {
    let testId: `0x${string}`;
    let dev: `0x${string}`;
    let msig: `0x${string}`;
    let alice: `0x${string}`;
    let bob: `0x${string}`;
    let carol: `0x${string}`;
    let dave: `0x${string}`;
    let boosterContractAddress: `0x${string}`;
    let boostEthContractAddress : `0x${string}`;
    let blastContractAddress : `0x${string}`;

    before(async () => {
        await anvilFork.start();
        await testClient.reset();
    })

    beforeEach(async () => {
        dev = (await walletClient.getAddresses())[0];
        msig = (await walletClient.getAddresses())[1];
        alice = (await walletClient.getAddresses())[2];
        bob = (await walletClient.getAddresses())[3];
        carol = (await walletClient.getAddresses())[4];
        dave = (await walletClient.getAddresses())[5];
  
        await testClient.setBalance({
          address: dev,
          value: parseEther('1000')
        })
        await testClient.setBalance({
            address: alice,
            value: parseEther('1000')
        })
        await testClient.setBalance({
            address: bob,
            value: parseEther('1000')
        })
        await testClient.setBalance({
            address: carol,
            value: parseEther('1000')
        })
        await testClient.setBalance({
            address: dave,
            value: parseEther('1000')
        })
        await testClient.setBalance({
            address: msig,
            value: parseEther('0')
        })

        await testClient.mine({ blocks: 1 });
  
        const boostEthContractHash = await walletClient.deployContract({
          abi: boostEthABI,
          account: dev,
          bytecode: cast0x(BoostETH.bytecode.object),
          args: [],
        });
        await testClient.mine({ blocks: 1, interval: 1 });
        const txr = await publicClient.getTransactionReceipt({ hash: boostEthContractHash });
        assert.strictEqual(txr.status, "success");
    
        boostEthContractAddress = txr.contractAddress!;

        const boosterContractHash = await walletClient.deployContract({
            abi: boosterABI,
            account: dev,
            bytecode: cast0x(Booster.bytecode.object),
            args: [msig, 3600, boostEthContractAddress],
        });
        await testClient.mine({ blocks: 1, interval: 1 });
        const txr2 = await publicClient.getTransactionReceipt({ hash: boosterContractHash });
        assert.strictEqual(txr2.status, "success");
    
        boosterContractAddress = txr2.contractAddress!;

        const blastContractHash = await walletClient.deployContract({
            abi: mockErc20ABI,
            account: dev,
            bytecode: cast0x(MockERC20.bytecode.object),
            args: [],
        });
        await testClient.mine({ blocks: 1, interval: 1 });
        const txr3 = await publicClient.getTransactionReceipt({ hash: blastContractHash });
        assert.strictEqual(txr3.status, "success");
    
        blastContractAddress = txr3.contractAddress!;

        const transferRequest = await publicClient.simulateContract({
            account: dev,
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "transfer",
            args: [boosterContractAddress, parseEther("1000000")]
        })

        await walletClient.writeContract(transferRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const startRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "start",
            args: []
        })

        await walletClient.writeContract(startRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const setMinterRequest = await publicClient.simulateContract({
            account: dev,
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "setMinter",
            args: [boosterContractAddress, true]
        })

        await walletClient.writeContract(setMinterRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        testId = await testClient.snapshot();
    });
    
    afterEach(async () => {
        await testClient.reset();
    });
    after(async () => {
        await anvilFork.stop();
    });

    test("Test params", async () => {
        const startTime: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "startTime",
            args: []
        }) as bigint

        assert.notEqual(startTime, 0n)

        const currentTime = BigInt(Math.floor(Date.now() / 1000));

        const modifyParamsRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "modifyParams",
            args: [currentTime, 6000n, boostEthContractAddress]
        })

        await walletClient.writeContract(modifyParamsRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const newStartTime: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "startTime",
            args: []
        }) as bigint

        const newEpochLength: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochLength",
            args: []
        }) as bigint

        const bstEth: Address = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "bstETH",
            args: []
        }) as Address

        assert.equal(newStartTime, currentTime)
        assert.equal(newEpochLength, 6000n)
        assert.equal(bstEth.toLowerCase(), boostEthContractAddress)
    })

    test("Lend/borrow epoch 0", async () => {
        const epochLength: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochLength",
            args: []
        }) as bigint

        const currentEpoch: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 0n)

        const lendRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let aliceLoan: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, parseEther('100'))

        let totalLent: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('100'))

        const lendRequest2 = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        aliceLoan = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, parseEther('200'))

        totalLent = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('200'))

        const lendRequest3 = await publicClient.simulateContract({
            account: bob,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [bob]
        })

        await walletClient.writeContract(lendRequest3.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let bobLoan: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, bob]
        }) as bigint

        assert.equal(bobLoan, parseEther('100'))

        totalLent = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('300'))

        const aliceBoostEth: bigint = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [alice]
        }) as bigint

        assert.equal(aliceBoostEth, parseEther('200'))

        const bobBoostEth: bigint = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [bob]
        }) as bigint

        assert.equal(bobBoostEth, parseEther('100'))

        const boosterContractBalance: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("300"))

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "claim",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Nothing to claim"))
        }
        
        const borrowRequest = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [carol]
        })

        await walletClient.writeContract(borrowRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let carolBorrow: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, carol]
        }) as bigint

        assert.equal(carolBorrow, parseEther('10'))

        let totalBorrowed: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalBorrowedPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalBorrowed, parseEther('10'))

        const borrowRequest2 = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [carol]
        })

        await walletClient.writeContract(borrowRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        carolBorrow = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, carol]
        }) as bigint

        assert.equal(carolBorrow, parseEther('20'))

        totalBorrowed = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalBorrowedPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalBorrowed, parseEther('20'))

        const borrowRequest3 = await publicClient.simulateContract({
            account: dave,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [dave]
        })

        await walletClient.writeContract(borrowRequest3.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const daveBorrow: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, dave]
        }) as bigint

        assert.equal(daveBorrow, parseEther('10'))

        totalBorrowed = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalBorrowedPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalBorrowed, parseEther('30'))

        const boosterContractBalance2: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance2, parseEther("330"))

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "claim",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Epoch has not passed"))
        }

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "withdrawToMsig",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Epoch has not passed"))
        }

        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        const currentEpoch2: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch2, 1n)

        try {
            await publicClient.simulateContract({
                account: carol,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "claim",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Nothing lent during epoch"))
        }

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "refund",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Nothing to refund"))
        }

        const claimRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "claim",
            args: [currentEpoch]
        })

        await walletClient.writeContract(claimRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const claimRequest2 = await publicClient.simulateContract({
            account: bob,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "claim",
            args: [currentEpoch]
        })

        await walletClient.writeContract(claimRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        aliceLoan = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, 0n)

        const aliceBalance: bigint = await publicClient.getBalance({ address: alice })
        if (aliceBalance < parseEther("819") || aliceBalance > parseEther("820")) {
            assert(false)
        }

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "claim",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Nothing lent during epoch"))
        }

        bobLoan = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, bob]
        }) as bigint

        assert.equal(bobLoan, 0n)

        const bobBalance: bigint = await publicClient.getBalance({ address: bob })
        if (bobBalance < parseEther("909") || bobBalance > parseEther("910")) {
            assert(false)
        }

        const boosterContractBalance3: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance3, parseEther("300"))

        const withdrawToMsigRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "withdrawToMsig",
            args: [currentEpoch]
        })

        await walletClient.writeContract(withdrawToMsigRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const msigBalance: bigint = await publicClient.getBalance({ address: msig })
        assert.equal(msigBalance, parseEther("300"))

        const boosterContractBalance4: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance4, parseEther("0"))

        const epochToCollected: boolean = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToCollected",
            args: [currentEpoch]
        }) as boolean

        assert(epochToCollected)

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "withdrawToMsig",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Already collected for epoch"))
        }
    })

    test("Empty borrow epoch", async () => {
        const epochLength: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochLength",
            args: []
        }) as bigint

        const currentEpoch: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 0n)

        const lendRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "refund",
                args: [currentEpoch]
            })
        } catch (e) {
            assert(String(e).includes("Epoch has not passed"))
        }

        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        const withdrawToMsigRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "withdrawToMsig",
            args: [currentEpoch]
        })

        await walletClient.writeContract(withdrawToMsigRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const epochToCollected: boolean = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToCollected",
            args: [currentEpoch]
        }) as boolean

        assert(epochToCollected)

        let aliceLoan: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, parseEther('100'))

        let aliceBoostEth: bigint = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [alice]
        }) as bigint

        assert.equal(aliceBoostEth, parseEther('100'))

        const approveRequest = await publicClient.simulateContract({
            account: alice,
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "approve",
            args: [boosterContractAddress, parseEther("100")]
        })

        await walletClient.writeContract(approveRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let boosterContractBalance: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("100"))

        const refundRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "refund",
            args: [currentEpoch]
        })

        await walletClient.writeContract(refundRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        aliceBoostEth = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [alice]
        }) as bigint

        assert.equal(aliceBoostEth, parseEther('0'))

        aliceLoan = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, parseEther('0'))

        const aliceBalance: bigint = await publicClient.getBalance({ address: alice })
        if (aliceBalance < parseEther("999") || aliceBalance > parseEther("1000")) {
            assert(false)
        }

        boosterContractBalance = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("0"))
    })

    test("Empty lend epoch", async () => {
        const epochLength: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochLength",
            args: []
        }) as bigint

        const currentEpoch: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 0n)

        const borrowRequest = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [carol]
        })

        await walletClient.writeContract(borrowRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        const withdrawToMsigRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "withdrawToMsig",
            args: [currentEpoch]
        })

        await walletClient.writeContract(withdrawToMsigRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const epochToCollected: boolean = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToCollected",
            args: [currentEpoch]
        }) as boolean

        assert(epochToCollected)

        let carolBorrow: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, carol]
        }) as bigint

        assert.equal(carolBorrow, parseEther('10'))

        let boosterContractBalance: bigint = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("10"))

        const refundRequest = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "refund",
            args: [currentEpoch]
        })

        await walletClient.writeContract(refundRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        carolBorrow = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, carol]
        }) as bigint

        assert.equal(carolBorrow, parseEther('0'))

        const carolBalance: bigint = await publicClient.getBalance({ address: carol })
        if (carolBalance < parseEther("999") || carolBalance > parseEther("1000")) {
            assert(false)
        }

        boosterContractBalance = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("0"))
    })

    test("Complete cycle", async () => {
        const epochLength: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochLength",
            args: []
        }) as bigint

        let currentEpoch: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 0n)

        const lendRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('200'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let aliceLoan: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, alice]
        }) as bigint

        assert.equal(aliceLoan, parseEther('200'))

        let totalLent: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('200'))

        const lendRequest2 = await publicClient.simulateContract({
            account: bob,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [bob]
        })

        await walletClient.writeContract(lendRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let bobLoan: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "loans",
            args: [currentEpoch, bob]
        }) as bigint

        assert.equal(bobLoan, parseEther('100'))

        totalLent = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('300'))

        const borrowRequest = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('20'),
            args: [carol]
        })

        await walletClient.writeContract(borrowRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let carolBorrow: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, carol]
        }) as bigint

        assert.equal(carolBorrow, parseEther('20'))

        const borrowRequest2 = await publicClient.simulateContract({
            account: dave,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [dave]
        })

        await walletClient.writeContract(borrowRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const daveBorrow: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [currentEpoch, dave]
        }) as bigint

        assert.equal(daveBorrow, parseEther('10'))

        let totalBorrowed: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalBorrowedPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalBorrowed, parseEther('30'))

        // Skip to epoch 1
        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        currentEpoch = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 1n)

        const lendRequest3 = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest3.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        totalLent = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "totalLentPerEpoch",
            args: [currentEpoch]
        }) as bigint

        assert.equal(totalLent, parseEther('100'))

        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        currentEpoch = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 2n)

        const lendRequest4 = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lend",
            value: parseEther('100'),
            args: [alice]
        })

        await walletClient.writeContract(lendRequest4.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        const borrowRequest3 = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrow",
            value: parseEther('10'),
            args: [carol]
        })

        await walletClient.writeContract(borrowRequest3.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        // Skip to epoch 3

        await testClient.mine({ blocks: 1, interval: Number(epochLength) });
        await testClient.mine({ blocks: 1, interval: 1 });

        currentEpoch = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "getCurrentEpoch",
            args: []
        }) as bigint

        assert.equal(currentEpoch, 3n)

        // Check that redeem + calculate all revert bc not stopped
        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemPrincipalETH",
                args: [parseEther("100")]
            })
        } catch (e) {
            assert(String(e).includes("Still ongoing"))
        }

        try {
            await publicClient.simulateContract({
                account: carol,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemBlastAirdrop",
                args: [0n]
            })
        } catch (e) {
            assert(String(e).includes("Still ongoing"))
        }

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "calculateEpochContributions",
                args: [0n, 3n]
            })
        } catch (e) {
            assert(String(e).includes("Still ongoing"))
        }

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "calculateEpochContributions",
                args: [0n, 3n]
            })
        } catch (e) {
            assert(String(e).includes("Still ongoing"))
        }

        // Run stop
        const stopRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "stop",
            args: []
        })

        await walletClient.writeContract(stopRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "stop",
                args: []
            })
        } catch (e) {
            assert(String(e).includes("Already stopped"))
        }

        const stopped: boolean = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "stopped",
            args: []
        }) as boolean

        assert(stopped)

        const finalEpoch: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "finalEpoch",
            args: []
        }) as bigint

        assert.equal(finalEpoch, 3n)

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "lend",
                value: parseEther("100"),
                args: [alice]
            })
        } catch (e) {
            assert(String(e).includes("Stopped"))
        }

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "borrow",
                value: parseEther("100"),
                args: [alice]
            })
        } catch (e) {
            assert(String(e).includes("Stopped"))
        }

        const approveRequest = await publicClient.simulateContract({
            account: alice,
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "approve",
            args: [boosterContractAddress, parseEther("1000")]
        })

        await walletClient.writeContract(approveRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        // Redeem principal
        const redeemPrincipalEthRequest = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemPrincipalETH",
            args: [parseEther("300")]
        })

        await walletClient.writeContract(redeemPrincipalEthRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let aliceBoostEth: bigint = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [alice]
        }) as bigint

        assert.equal(aliceBoostEth, parseEther('100'))

        let boosterContractBalance = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("240"))

        const redeemPrincipalEthRequest2 = await publicClient.simulateContract({
            account: alice,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemPrincipalETH",
            args: [parseEther("100")]
        })

        await walletClient.writeContract(redeemPrincipalEthRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        aliceBoostEth = await publicClient.readContract({
            address: boostEthContractAddress,
            abi: boostEthABI,
            functionName: "balanceOf",
            args: [alice]
        }) as bigint

        assert.equal(aliceBoostEth, 0n)

        boosterContractBalance = await publicClient.getBalance({ address: boosterContractAddress })
        assert.equal(boosterContractBalance, parseEther("140"))

        try {
            await publicClient.simulateContract({
                account: alice,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "refund",
                args: [1n]
            })
        } catch (e) {
            assert(String(e).includes("transfer amount exceeds balance"))
        }

        // Run calculate
        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "calculateEpochContributions",
                args: [1n, 0n]
            })
        } catch (e) {
            assert(String(e).includes("Invalid range"))
        }

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "calculateEpochContributions",
                args: [1n, 4n]
            })
        } catch (e) {
            assert(String(e).includes("Invalid calc"))
        }

        try {
            await publicClient.simulateContract({
                account: dev,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "calculateEpochContributions",
                args: [0n, 4n]
            })
        } catch (e) {
            assert(String(e).includes("Out of range"))
        }

        const calculateRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "calculateEpochContributions",
            args: [0n, 1n]
        })

        await walletClient.writeContract(calculateRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        let lastCalculated: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lastCalculated",
            args: []
        }) as bigint

        assert.equal(lastCalculated, 1n)

        let epochToContributions: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToContributions",
            args: [0n]
        }) as bigint

        assert.equal(epochToContributions, parseEther('900'))

        let sumContributions: bigint = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "sumContributions",
            args: []
        }) as bigint

        assert.equal(sumContributions, parseEther('900'))

        epochToContributions = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToContributions",
            args: [1n]
        }) as bigint

        assert.equal(epochToContributions, 0n)

        try {
            await publicClient.simulateContract({
                account: carol,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemBlastAirdrop",
                args: [0n]
            })
        } catch (e) {
            assert(String(e).includes("Calculation ongoing"))
        }

        const calculateRequest2 = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "calculateEpochContributions",
            args: [2n, 3n]
        })

        await walletClient.writeContract(calculateRequest2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        epochToContributions = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToContributions",
            args: [2n]
        }) as bigint

        assert.equal(epochToContributions, parseEther('100'))

        epochToContributions = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "epochToContributions",
            args: [3n]
        }) as bigint

        assert.equal(epochToContributions, 0n)

        sumContributions = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "sumContributions",
            args: []
        }) as bigint

        assert.equal(sumContributions, parseEther('1000'))

        try {
            await publicClient.simulateContract({
                account: carol,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemBlastAirdrop",
                args: [0n]
            })
        } catch (e) {
            assert(String(e).includes("No blast address"))
        }

        lastCalculated = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "lastCalculated",
            args: []
        }) as bigint

        assert.equal(lastCalculated, 3n)

        let calculationComplete = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "calculationComplete",
            args: []
        }) as bigint

        assert(calculationComplete)

        // Set airdrop
        const airdropRequest = await publicClient.simulateContract({
            account: dev,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "setAirdrop",
            args: [blastContractAddress, parseEther("1000000")]
        })

        await walletClient.writeContract(airdropRequest.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        // Redeem airdrop
        try {
            await publicClient.simulateContract({
                account: carol,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemBlastAirdrop",
                args: [4n]
            })
        } catch (e) {
            assert(String(e).includes("Invalid epoch"))
        }

        const redeemBlastAirdrop = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemBlastAirdrop",
            args: [0n]
        })

        await walletClient.writeContract(redeemBlastAirdrop.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        carolBorrow = await publicClient.readContract({
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "borrows",
            args: [0n, carol]
        }) as bigint

        assert.equal(carolBorrow, 0n)

        let blastBalance: bigint = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [boosterContractAddress]
        }) as bigint

        assert.equal(blastBalance, parseEther("400000"))

        blastBalance = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [carol]
        }) as bigint

        assert.equal(blastBalance, parseEther("600000"))

        const redeemBlastAirdrop2 = await publicClient.simulateContract({
            account: dave,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemBlastAirdrop",
            args: [0n]
        })

        await walletClient.writeContract(redeemBlastAirdrop2.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        // This should do nothing since Dave didn't borrow in epoch 2
        const redeemBlastAirdrop3 = await publicClient.simulateContract({
            account: dave,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemBlastAirdrop",
            args: [2n]
        })

        await walletClient.writeContract(redeemBlastAirdrop3.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        try {
            await publicClient.simulateContract({
                account: dave,
                address: boosterContractAddress,
                abi: boosterABI,
                functionName: "redeemBlastAirdrop",
                args: [3n]
            })
        } catch (e) {
            assert(String(e).includes("Empty epoch"))
        }

        blastBalance = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [boosterContractAddress]
        }) as bigint

        assert.equal(blastBalance, parseEther("100000"))

        blastBalance = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [dave]
        }) as bigint

        assert.equal(blastBalance, parseEther("300000"))

        const redeemBlastAirdrop4 = await publicClient.simulateContract({
            account: carol,
            address: boosterContractAddress,
            abi: boosterABI,
            functionName: "redeemBlastAirdrop",
            args: [2n]
        })

        await walletClient.writeContract(redeemBlastAirdrop4.request);
        await testClient.mine({ blocks: 1, interval: 1 });

        blastBalance = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [carol]
        }) as bigint

        assert.equal(blastBalance, parseEther("700000"))

        blastBalance = await publicClient.readContract({
            address: blastContractAddress,
            abi: mockErc20ABI,
            functionName: "balanceOf",
            args: [boosterContractAddress]
        }) as bigint

        assert.equal(blastBalance, parseEther("0"))
    })
})