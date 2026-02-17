export const V7_CONTRACT_ADDRESS = '0x5bd96fbfcd94049837bb4234872fb60ffd086c91' as const;

export const V7_ABI = [
  {
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'ipfsHash', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'jbmAmount', type: 'uint256' },
      { name: 'nativeTokenAmount', type: 'uint256' },
      { name: 'daimoPaymentId', type: 'string' },
      { name: 'signature', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'claimBungalow',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    name: 'getBungalowByToken',
    outputs: [
      {
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'currentOwner', type: 'address' },
          { name: 'verifiedAdmin', type: 'address' },
          { name: 'originalClaimer', type: 'address' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'ipfsHash', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'isVerifiedClaimed', type: 'bool' },
          { name: 'jbmPaid', type: 'uint256' },
          { name: 'nativeTokenPaid', type: 'uint256' },
          { name: 'daimoPaymentId', type: 'string' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    name: 'getBungalowIdByToken',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getHeat',
    outputs: [{ name: 'heat', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'bungalowId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    name: 'getLagoonBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'getTotalLagoonBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'bungalowCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'bungalowId', type: 'uint256' }],
    name: 'isBungalowVerified',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'bungalowId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'depositToLagoon',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'bungalowId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    name: 'withdrawFromLagoon',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'bungalowId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    name: 'distributeLagoonRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ERC20 approve for lagoon deposits
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
