import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, upgrades } from "hardhat";
import { NETWORK } from "../lib/env";
const {
  DEPOSIT_CONTRACT_ADDRESS,
  ADDRESSES,
  WETH_ABI,
  NATIVE,
} = require(`../lib/constants/${NETWORK}`);
import { toEthers } from "../lib/utils";

const provider = ethers.provider;

describe("Staking", function () {
  async function deployTest() {
    const [owner, updater, activator, treasury, user] = await ethers.getSigners();
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await upgrades.deployProxy(
      Staking,
      [
        DEPOSIT_CONTRACT_ADDRESS,
        ADDRESSES[NATIVE],
        treasury.address,
        updater.address,
        activator.address,
      ],
      {
        initializer: "initialize",
      }
    );
    await staking.deployed();

    const Withdrawal = await ethers.getContractFactory("Withdrawal");
    const withdrawal = await upgrades.deployProxy(Withdrawal, [staking.address], {
      initializer: "initialize",
    });
    await withdrawal.deployed();

    await staking.updateWithdrawal(withdrawal.address);
    const wethC = new ethers.Contract(ADDRESSES[NATIVE], WETH_ABI);
    const UPDATER_ROLE = await staking.UPDATER_ROLE();
    const ACTIVATOR_ROLE = await staking.ACTIVATOR_ROLE();

    return {
      staking,
      owner,
      updater,
      activator,
      user,
      treasury,
      wethC,
      withdrawal,
      UPDATER_ROLE,
      ACTIVATOR_ROLE,
    };
  }

  describe("Withdraw", function () {
    var staking: Contract,
      withdrawal: Contract,
      owner: SignerWithAddress,
      user: SignerWithAddress;

    it("Deposit ETH for mpETH", async () => {
      ({ user, owner, staking, withdrawal } = await loadFixture(deployTest));
      const depositAmount = toEthers(32);
      await staking.connect(user).depositETH(user.address, { value: depositAmount });
    });

    it("Request withdraw", async () => {
      const userBalance = await staking.balanceOf(user.address);
      const withdrawalDelay = await withdrawal.WITHDRAWAL_DELAY();
      await staking.connect(user).approve(staking.address, userBalance);
      await staking.connect(user).withdraw(userBalance, user.address, user.address);
      const unlockTimestamp = BigNumber.from(
        (await provider.getBlock("latest")).timestamp + withdrawalDelay
      );
      const unlockDay = unlockTimestamp.div(24 * 60 * 60).mod(7);
      expect(await staking.balanceOf(user.address)).to.eq(0);
      expect((await withdrawal.pendingWithdraws(user.address)).amount).to.eq(userBalance);
      expect((await withdrawal.pendingWithdraws(user.address)).unlockTimestamp).to.eq(
        unlockTimestamp
      );
      expect(await withdrawal.totalPendingWithdraw()).to.eq(userBalance);
      expect(await withdrawal.pendingWithdrawsPerDay(unlockDay)).to.eq(userBalance);
    });

    it("Complete withdraw must revert before unlock time", async () => {
      await expect(withdrawal.connect(user).completeWithdraw()).to.be.revertedWith(
        "Withdrawal delay not reached"
      );
    });

    it("Complete withdraw must revert with insufficient balance", async () => {
      const unlockTimestamp = (await withdrawal.pendingWithdraws(user.address))
        .unlockTimestamp;
      await time.increaseTo(unlockTimestamp);
      await expect(withdrawal.connect(user).completeWithdraw()).to.be.revertedWith(
        "Address: insufficient balance"
      );
    });

    it("Complete withdraw", async () => {
      await owner.sendTransaction({
        to: withdrawal.address,
        value: (await withdrawal.pendingWithdraws(user.address)).amount,
      });
      const withdrawalDelay = await withdrawal.WITHDRAWAL_DELAY();
      const unlockTimestamp = BigNumber.from(
        (await provider.getBlock("latest")).timestamp + withdrawalDelay
      );
      const unlockDay = unlockTimestamp.div(24 * 60 * 60).mod(7);
      await withdrawal.connect(user).completeWithdraw();
      expect((await withdrawal.pendingWithdraws(user.address)).amount).to.eq(0);
      expect((await withdrawal.pendingWithdraws(user.address)).unlockTimestamp).to.eq(0);
      expect(await withdrawal.totalPendingWithdraw()).to.eq(0);
      expect(await withdrawal.pendingWithdrawsPerDay(unlockDay)).to.eq(0);
    });
  });

  describe("Stake remaining", async () => {
    var staking: Contract,
      withdrawal: Contract,
      owner: SignerWithAddress,
      user: SignerWithAddress;

    it("Revert stake with 0 ETH balance", async () => {
      ({ user, owner, staking, withdrawal } = await loadFixture(deployTest));

      await expect(withdrawal.stakeRemaining()).to.be.revertedWith(
        "No ETH available to stake"
      );
    });

    it("Revert staking with pending withdraw gt balance", async () => {
      const value = toEthers(32);
      await staking.connect(user).depositETH(user.address, { value });
      await staking.connect(user).approve(staking.address, value);
      await staking.connect(user).withdraw(value, user.address, user.address);
      expect(await withdrawal.totalPendingWithdraw()).to.eq(value);

      await owner.sendTransaction({
        to: withdrawal.address,
        value,
      });

      await expect(withdrawal.stakeRemaining()).to.be.revertedWith(
        "No ETH available to stake"
      );
    });

    it("Stake remaining ETH", async () => {
      ({ user, owner, staking, withdrawal } = await loadFixture(deployTest));

      const value = toEthers(32);
      await owner.sendTransaction({
        to: withdrawal.address,
        value,
      });

      expect(await provider.getBalance(withdrawal.address)).eq(value);
      expect(await provider.getBalance(staking.address)).eq(0);
      await withdrawal.stakeRemaining();
      expect(await provider.getBalance(withdrawal.address)).eq(0);
      expect(await provider.getBalance(staking.address)).eq(value);
      expect(await staking.stakingBalance()).eq(value);
    });
  });
});
