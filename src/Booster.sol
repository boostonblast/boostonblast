// SPDX-License-Identifier: MIT-LICENSE

pragma solidity >=0.7.6;

import {SafeMath} from "./libraries/SafeMath.sol";
import {Ownable} from "./Ownable.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./SafeERC20.sol";
import {IMintableBurnableERC20} from "./interfaces/IMintableBurnableERC20.sol";

contract Booster is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    address public immutable msig;
    // Start time of epoch 0
    uint256 public startTime;
    // In seconds
    uint256 public epochLength;
    address public bstETH;
    bool public stopped;
    uint256 public finalEpoch;
    uint256 public lastCalculated;
    bool public calculationComplete;
    address public blast;
    uint256 public totalAirdrop;

    // Epoch to user to loan amounts
    mapping(uint256 => mapping(address => uint256)) public loans;
    // Epoch to total lent
    mapping(uint256 => uint256) public totalLentPerEpoch;
    // Epoch to user to borrows
    mapping(uint256 => mapping(address => uint256)) public borrows;
    // Epoch to total borrowed
    mapping(uint256 => uint256) public totalBorrowedPerEpoch;
    // Epoch to collected (to msig)
    mapping(uint256 => bool) public epochToCollected;
    /* Epoch to contributions toward airdrop
    * Uses the following formula:
    * totalLentPerEpoch[_epoch] * (finalEpoch - _epoch)
    * This gives us a representation of an epoch's contribution
    * To get proportional contribution toward the airdrop, we divide by sumContributions
    */
    mapping(uint256 => uint256) public epochToContributions;
    uint256 public sumContributions;

    constructor(address _msig, uint256 _epochLength, address _bstETH) {
        msig = _msig;
        epochLength = _epochLength;
        bstETH = _bstETH;
    }

    event Loan(address indexed user, uint256 indexed timeStamp, uint256 indexed epoch, uint256 amount);
    event Borrow(address indexed user, uint256 indexed timeStamp, uint256 indexed epoch, uint256 amount);
    event Claim(address indexed user, uint256 indexed timeStamp, uint256 indexed epoch, uint256 amount);
    event Refund(address indexed user, uint256 indexed timeStamp, uint256 indexed epoch, uint256 amount);
    event RedeemPrincipal(address indexed user, uint256 indexed timeStamp, uint256 amount);
    event RedeemAirdrop(address indexed user, uint256 indexed timeStamp, uint256 indexed epoch, uint256 correspondingEthPaid, uint256 airdropAmount);

    receive() external payable {}

    fallback() external payable {}

    // If for some reason ERC20 tokens are sent to the contract, allow withdrawal
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(_to, _amount);
    }

    // Emergency ETH withdraw - only msig wallet can run
    function emergencyWithdrawETH(uint256 _amount) external {
        require(msg.sender == msig, "Not msig");
        (bool sent, ) = msig.call{value: _amount}("");
        require(sent, "Failed to send Ether");
    }

    // Withdraw to msig wallet for Blast farming
    function withdrawToMsig(uint256 _epoch) external onlyOwner {
        require(getCurrentEpoch() > _epoch, "Epoch has not passed");
        require(!epochToCollected[_epoch], "Already collected for epoch");
        epochToCollected[_epoch] = true;
        if (totalLentPerEpoch[_epoch] == 0 || totalBorrowedPerEpoch[_epoch] == 0) {
            return;
        }
        // Send ETH to msig
        (bool sent, ) = msig.call{value: totalLentPerEpoch[_epoch]}("");
        require(sent, "Failed to send Ether");
    }

    function lend(address _lender) external payable {
        require(!stopped, "Stopped");
        require(msg.value > 0, "No ETH sent");
        require(startTime != 0, "Not started");
        uint256 currentEpoch = getCurrentEpoch();
        loans[currentEpoch][_lender] = loans[currentEpoch][_lender].add(msg.value);
        totalLentPerEpoch[currentEpoch] = totalLentPerEpoch[currentEpoch].add(msg.value);
        // Mint receipt token
        IMintableBurnableERC20(bstETH).mint(_lender, msg.value);

        // Emit lend event
        emit Loan(_lender, block.timestamp, currentEpoch, msg.value);
    }

    function claim(uint256 _epoch) external {
        // If borrowed / lent is 0, users should be collecting their refund
        require(totalLentPerEpoch[_epoch] != 0 && totalBorrowedPerEpoch[_epoch] != 0, "Nothing to claim");
        require(getCurrentEpoch() > _epoch, "Epoch has not passed");
        require(loans[_epoch][msg.sender] > 0, "Nothing lent during epoch");
        uint256 lentAmount = loans[_epoch][msg.sender];
        loans[_epoch][msg.sender] = 0;
        uint256 amountToSend = totalBorrowedPerEpoch[_epoch].mul(lentAmount).div(totalLentPerEpoch[_epoch]);
        (bool sent, ) = msg.sender.call{value: amountToSend}("");
        require(sent, "Failed to send Ether");

        // Emit claim event
        emit Claim(msg.sender, block.timestamp, _epoch, amountToSend);
    }

    function borrow(address _borrower) external payable {
        require(!stopped, "Stopped");
        require(msg.value > 0, "No ETH sent");
        require(startTime != 0, "Not started");
        uint256 currentEpoch = getCurrentEpoch();
        borrows[currentEpoch][_borrower] = borrows[currentEpoch][_borrower].add(msg.value);
        totalBorrowedPerEpoch[currentEpoch] = totalBorrowedPerEpoch[currentEpoch].add(msg.value);

        // Emit borrow event
        emit Borrow(_borrower, block.timestamp, currentEpoch, msg.value);
    }

    // Function to get refunded if total lent / borrowed was 0 in an epoch
    function refund(uint256 _epoch) external {
        require(totalLentPerEpoch[_epoch] == 0 || totalBorrowedPerEpoch[_epoch] == 0, "Nothing to refund this epoch");
        require(getCurrentEpoch() > _epoch, "Epoch has not passed");
        uint256 ethToRefund = 0;
        if (totalLentPerEpoch[_epoch] == 0) {
            uint256 userBorrows = borrows[_epoch][msg.sender];
            if (userBorrows > 0) {
                borrows[_epoch][msg.sender] = 0;
                ethToRefund = ethToRefund.add(userBorrows);
            }
        }
        if (totalBorrowedPerEpoch[_epoch] == 0) {
            uint256 userLoans = loans[_epoch][msg.sender];
            if (userLoans > 0) {
                // Burn receipt token
                IERC20(bstETH).safeTransferFrom(msg.sender, address(this), userLoans);
                IMintableBurnableERC20(bstETH).burn(userLoans);
                loans[_epoch][msg.sender] = 0;
                ethToRefund = ethToRefund.add(userLoans);
            }
        }
        require(ethToRefund > 0, "Nothing to refund");
        // Refund ETH to user
        (bool sent, ) = msg.sender.call{value: ethToRefund}("");
        require(sent, "Failed to send Ether");

        // Emit refund event
        emit Refund(msg.sender, block.timestamp, _epoch, ethToRefund);
    }

    function redeemPrincipalETH(uint256 _amount) external {
        require(stopped, "Still ongoing");
        // Burn receipt token
        IERC20(bstETH).safeTransferFrom(msg.sender, address(this), _amount);
        IMintableBurnableERC20(bstETH).burn(_amount);
        // Redeem ETH to user
        (bool sent, ) = msg.sender.call{value: _amount}("");
        require(sent, "Failed to send Ether");

        // Emit redeem principal event
        emit RedeemPrincipal(msg.sender, block.timestamp, _amount);
    }

    function redeemBlastAirdrop(uint256 _epoch) external {
        require(stopped, "Still ongoing");
        require(calculationComplete, "Calculation ongoing");
        require(blast != address(0), "No blast address");
        require(_epoch <= finalEpoch, "Invalid epoch");
        require(totalBorrowedPerEpoch[_epoch] != 0 && totalLentPerEpoch[_epoch] != 0, "Empty epoch");

        uint256 borrowedDuringEpoch = borrows[_epoch][msg.sender];
        borrows[_epoch][msg.sender] = 0;
        uint256 blastOwedForEpoch = epochToContributions[_epoch].mul(borrowedDuringEpoch).mul(totalAirdrop).div(sumContributions).div(totalBorrowedPerEpoch[_epoch]);
        IERC20(blast).transfer(msg.sender, blastOwedForEpoch);

        // Emit redeem airdrop event
        emit RedeemAirdrop(msg.sender, block.timestamp, _epoch, borrowedDuringEpoch, blastOwedForEpoch);
    }

    function start() external onlyOwner {
        require(startTime == 0, "Already started");
        startTime = block.timestamp;
    }

    function stop() external onlyOwner {
        require(!stopped, "Already stopped");
        stopped = true;
        finalEpoch = getCurrentEpoch();
    }

    // In case we have too many epochs and loop becomes too long, we allow slicing over multiple transactions
    function calculateEpochContributions(uint256 _startEpoch, uint256 _endEpoch) external onlyOwner {
        require(stopped, "Still ongoing");
        require(_endEpoch > _startEpoch, "Invalid range");
        require(_startEpoch == 0 || (lastCalculated != 0 && _startEpoch == lastCalculated + 1), "Invalid calc");
        require(_endEpoch <= finalEpoch, "Out of range");
        require(!calculationComplete, "Already complete");

        for (uint256 i = _startEpoch; i < _endEpoch; i++) {
            if (totalLentPerEpoch[i] != 0 && totalBorrowedPerEpoch[i] != 0) {
                epochToContributions[i] = totalLentPerEpoch[i].mul(finalEpoch.sub(i));
                sumContributions = sumContributions.add(epochToContributions[i]);
            }
        }

        lastCalculated = _endEpoch;
        if (_endEpoch == finalEpoch) {
            calculationComplete = true;
        }
    }

    function modifyParams(uint256 _startTime, uint256 _epochLength, address _bstETH) external onlyOwner {
        startTime = _startTime;
        epochLength = _epochLength;
        bstETH = _bstETH;
    }

    function setAirdrop(address _blast, uint256 _totalAirdrop) external onlyOwner {
        blast = _blast;
        totalAirdrop = _totalAirdrop;
    }

    function getCurrentEpoch() public view returns (uint256) {
        return block.timestamp.sub(startTime).div(epochLength);
    }

    function getEpoch(uint256 _timestamp) public view returns (uint256) {
        return _timestamp.sub(startTime).div(epochLength);
    }
}