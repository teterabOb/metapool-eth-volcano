// SPDX-License-Identifier: MIT
pragma solidity ^0.8;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "./Staking.sol";

struct withdrawRequest {
    uint amount;
    uint unlockEpoch;
}

/// @title Manage withdrawals from validators to users
/// @notice Receive request for withdrawals from Staking and allow users to complete the withdrawals once the epoch is reached
/// @dev As the disassemble of validators is delayed, this contract manage the pending withdraw from users to allow the to complet it once his unlockEpoch is reached and if the contract has enough ETH
/// The epochs are of one week
contract Withdrawal is OwnableUpgradeable {
    using AddressUpgradeable for address payable;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address payable public mpETH;
    uint public totalPendingWithdraw;
    uint public startTimestamp;
    mapping(address => withdrawRequest) public pendingWithdraws;

    event RequestWithdraw(address indexed user, uint amount, uint unlockEpoch);
    event CompleteWithdraw(address indexed user, uint amount, uint unlockEpoch);

    modifier onlyStaking() {
        require(msg.sender == mpETH, "Caller not Staking");
        _;
    }

    receive() external payable {}

    function initialize(address payable _mpETH) external initializer {
        __Ownable_init();
        startTimestamp = block.timestamp;
        mpETH = _mpETH;
    }

    /// @return epoch Returns the current epoch
    function getEpoch() public view returns (uint epoch) {
        return (block.timestamp - startTimestamp) / 7 days;
    }

    /// @notice Queue ETH withdrawal
    /// @dev Multiples withdrawals are accumulative, but will restart the epoch unlock
    /// @param _amountOut ETH amount to withdraw
    /// @param _user Owner of the withdrawal
    function requestWithdraw(uint _amountOut, address _user) external onlyStaking {
        uint unlockEpoch = getEpoch() + 1;
        pendingWithdraws[_user].amount += _amountOut;
        pendingWithdraws[_user].unlockEpoch = unlockEpoch;
        totalPendingWithdraw += _amountOut;
        emit RequestWithdraw(_user, _amountOut, unlockEpoch);
    }

    /// @notice Process pending withdrawal if there's enough ETH
    function completeWithdraw() external {
        withdrawRequest memory _withdrawR = pendingWithdraws[msg.sender];
        require(
            getEpoch() >= _withdrawR.unlockEpoch,
            "Withdrawal delay not reached"
        );
        require(_withdrawR.amount > 0, "Nothing to withdraw");
        totalPendingWithdraw -= _withdrawR.amount;
        delete pendingWithdraws[msg.sender];
        payable(msg.sender).sendValue(_withdrawR.amount);
        emit CompleteWithdraw(
            msg.sender,
            _withdrawR.amount,
            _withdrawR.unlockEpoch
        );
    }

    /// @notice Send ETH _amount to Staking
    /// @dev As the validators are always fully disassembled, the contract can have more ETH than the needed for withdrawals. So the Staking can take this ETH and send it again to validators. This shouldn't mint new mpETH
    function getEthForValidator(uint _amount) external onlyStaking {
        require(_amount <= ethRemaining(), "Not enough ETH to stake");
        mpETH.sendValue(_amount);
    }

    /// @notice Returns the ETH not assigned to any withdrawal
    function ethRemaining() public view returns (uint) {
        return
            (address(this).balance > totalPendingWithdraw)
                ? address(this).balance - totalPendingWithdraw
                : 0;
    }
}
