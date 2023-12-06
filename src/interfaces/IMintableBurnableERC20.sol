pragma solidity >=0.7.6;

interface IMintableBurnableERC20 {
    function burn(uint256 _amount) external;
    function mint(address _to, uint256 _amount) external;
}