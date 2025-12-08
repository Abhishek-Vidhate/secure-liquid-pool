/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/securelp.json`.
 */
export type Securelp = {
  "address": "BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21",
  "metadata": {
    "name": "securelp",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "MEV-Resistant Liquid Staking DApp - SecureLiquidPool"
  },
  "instructions": [
    {
      "name": "cancelCommitment",
      "docs": [
        "Cancel Commitment: Allow user to cancel their commitment and reclaim rent",
        "",
        "This can only be called by the original user who created the commitment."
      ],
      "discriminator": [
        36,
        39,
        70,
        137,
        71,
        179,
        88,
        232
      ],
      "accounts": [
        {
          "name": "commitment",
          "docs": [
            "The commitment PDA to close"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user who created the commitment"
          ],
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "commit",
      "docs": [
        "Commit Phase: Store a blinded hash of swap intent",
        "",
        "This instruction creates a commitment PDA that stores the SHA-256 hash",
        "of the user's swap details. The actual parameters remain hidden from",
        "MEV bots observing the mempool.",
        "",
        "# Arguments",
        "* `hash` - SHA-256 hash of serialized SwapDetails",
        "* `amount_lamports` - Amount being staked (for display/tracking)",
        "* `is_stake` - true for SOL->slpSOL, false for slpSOL->SOL"
      ],
      "discriminator": [
        223,
        140,
        142,
        165,
        229,
        208,
        156,
        74
      ],
      "accounts": [
        {
          "name": "commitment",
          "docs": [
            "The commitment PDA to create"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user creating the commitment (pays for PDA rent)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program for PDA creation"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "amountLamports",
          "type": "u64"
        },
        {
          "name": "isStake",
          "type": "bool"
        }
      ]
    },
    {
      "name": "revealAndStake",
      "docs": [
        "Reveal and Stake: Verify commitment and execute SOL -> slpSOL deposit",
        "",
        "This instruction:",
        "1. Verifies the minimum delay has passed since commit",
        "2. Verifies the hash matches the provided SwapDetails",
        "3. Executes stake_pool deposit via CPI",
        "4. Closes the commitment PDA (returns rent to user)"
      ],
      "discriminator": [
        158,
        240,
        131,
        123,
        65,
        214,
        109,
        14
      ],
      "accounts": [
        {
          "name": "commitment",
          "docs": [
            "The commitment PDA to verify and close"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user executing the reveal (must match commitment creator)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePoolProgram",
          "docs": [
            "Stake pool program"
          ],
          "address": "EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7"
        },
        {
          "name": "poolConfig",
          "docs": [
            "Pool config PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "stakePoolProgram"
            }
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              }
            ],
            "program": {
              "kind": "account",
              "path": "stakePoolProgram"
            }
          }
        },
        {
          "name": "reserveVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              }
            ],
            "program": {
              "kind": "account",
              "path": "stakePoolProgram"
            }
          }
        },
        {
          "name": "slpMint",
          "docs": [
            "slpSOL mint"
          ],
          "writable": true
        },
        {
          "name": "userSlpAccount",
          "docs": [
            "User's slpSOL token account"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "details",
          "type": {
            "defined": {
              "name": "swapDetails"
            }
          }
        }
      ]
    },
    {
      "name": "revealAndSwap",
      "docs": [
        "Reveal and Swap: Verify commitment and execute AMM swap",
        "",
        "This instruction:",
        "1. Verifies the minimum delay has passed since commit",
        "2. Verifies the hash matches the provided SwapDetails",
        "3. Executes AMM swap via CPI",
        "4. Closes the commitment PDA (returns rent to user)"
      ],
      "discriminator": [
        171,
        39,
        209,
        99,
        33,
        15,
        82,
        135
      ],
      "accounts": [
        {
          "name": "commitment",
          "docs": [
            "The commitment PDA to verify and close"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user executing the reveal"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM program"
          ],
          "address": "AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS"
        },
        {
          "name": "ammPool",
          "docs": [
            "AMM pool"
          ],
          "writable": true
        },
        {
          "name": "ammAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "ammPool"
              }
            ],
            "program": {
              "kind": "account",
              "path": "ammProgram"
            }
          }
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Token A vault"
          ],
          "writable": true
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Token B vault"
          ],
          "writable": true
        },
        {
          "name": "userTokenIn",
          "docs": [
            "User's input token account"
          ],
          "writable": true
        },
        {
          "name": "userTokenOut",
          "docs": [
            "User's output token account"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "details",
          "type": {
            "defined": {
              "name": "swapDetails"
            }
          }
        },
        {
          "name": "aToB",
          "type": "bool"
        }
      ]
    },
    {
      "name": "revealAndUnstake",
      "docs": [
        "Reveal and Unstake: Verify commitment and execute slpSOL -> SOL withdrawal",
        "",
        "This instruction:",
        "1. Verifies the minimum delay has passed since commit",
        "2. Verifies the hash matches the provided SwapDetails",
        "3. Executes stake_pool withdrawal via CPI",
        "4. Closes the commitment PDA (returns rent to user)"
      ],
      "discriminator": [
        101,
        41,
        49,
        83,
        181,
        245,
        214,
        109
      ],
      "accounts": [
        {
          "name": "commitment",
          "docs": [
            "The commitment PDA to verify and close"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user executing the reveal (must match commitment creator)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePoolProgram",
          "docs": [
            "Stake pool program"
          ],
          "address": "EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7"
        },
        {
          "name": "poolConfig",
          "docs": [
            "Pool config PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "stakePoolProgram"
            }
          }
        },
        {
          "name": "reserveVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              }
            ],
            "program": {
              "kind": "account",
              "path": "stakePoolProgram"
            }
          }
        },
        {
          "name": "slpMint",
          "docs": [
            "slpSOL mint"
          ],
          "writable": true
        },
        {
          "name": "userSlpAccount",
          "docs": [
            "User's slpSOL token account"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token program"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "details",
          "type": {
            "defined": {
              "name": "swapDetails"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ammPool",
      "discriminator": [
        54,
        82,
        185,
        138,
        179,
        191,
        211,
        169
      ]
    },
    {
      "name": "commitment",
      "discriminator": [
        61,
        112,
        129,
        128,
        24,
        147,
        77,
        87
      ]
    },
    {
      "name": "poolConfig",
      "discriminator": [
        26,
        108,
        14,
        123,
        116,
        230,
        129,
        43
      ]
    }
  ],
  "events": [
    {
      "name": "stakeEvent",
      "discriminator": [
        226,
        134,
        188,
        173,
        19,
        33,
        75,
        175
      ]
    },
    {
      "name": "swapEvent",
      "discriminator": [
        64,
        198,
        205,
        232,
        38,
        8,
        113,
        226
      ]
    },
    {
      "name": "unstakeEvent",
      "discriminator": [
        162,
        104,
        137,
        228,
        81,
        3,
        79,
        197
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "delayNotMet",
      "msg": "Minimum delay not met. Wait at least 1 second after commit."
    },
    {
      "code": 6001,
      "name": "hashMismatch",
      "msg": "Hash mismatch. The provided swap details don't match the commitment."
    },
    {
      "code": 6002,
      "name": "commitmentNotFound",
      "msg": "Commitment not found or already used."
    },
    {
      "code": 6003,
      "name": "invalidMint",
      "msg": "Invalid token mint provided."
    },
    {
      "code": 6004,
      "name": "slippageTooHigh",
      "msg": "Slippage too high. Maximum allowed is 1000 bps (10%)."
    },
    {
      "code": 6005,
      "name": "amountTooSmall",
      "msg": "Amount too small. Minimum is 1,000,000 lamports (0.001 SOL)."
    },
    {
      "code": 6006,
      "name": "commitmentAlreadyExists",
      "msg": "Commitment already exists. Complete or cancel existing commitment first."
    },
    {
      "code": 6007,
      "name": "mathOverflow",
      "msg": "Math overflow occurred."
    },
    {
      "code": 6008,
      "name": "insufficientBalance",
      "msg": "Insufficient balance for this operation."
    }
  ],
  "types": [
    {
      "name": "ammPool",
      "docs": [
        "AMM Pool configuration"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Pool authority (admin)"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenAMint",
            "docs": [
              "Token A mint (typically wSOL for native SOL)"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenBMint",
            "docs": [
              "Token B mint (slpSOL)"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenAVault",
            "docs": [
              "Token A vault (PDA-owned)"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenBVault",
            "docs": [
              "Token B vault (PDA-owned)"
            ],
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "docs": [
              "LP token mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "reserveA",
            "docs": [
              "Current reserve of token A"
            ],
            "type": "u64"
          },
          {
            "name": "reserveB",
            "docs": [
              "Current reserve of token B"
            ],
            "type": "u64"
          },
          {
            "name": "totalLpSupply",
            "docs": [
              "Total LP tokens minted"
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Swap fee in basis points (e.g., 30 = 0.3%)"
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Whether pool is paused"
            ],
            "type": "bool"
          },
          {
            "name": "cumulativeFeeA",
            "docs": [
              "Cumulative fees collected for token A"
            ],
            "type": "u64"
          },
          {
            "name": "cumulativeFeeB",
            "docs": [
              "Cumulative fees collected for token B"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "Bump for this PDA"
            ],
            "type": "u8"
          },
          {
            "name": "authorityBump",
            "docs": [
              "Bump for authority PDA"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "commitment",
      "docs": [
        "Commitment PDA - stores the blinded swap intent",
        "Seeds: [\"commit\", user_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who created this commitment"
            ],
            "type": "pubkey"
          },
          {
            "name": "hash",
            "docs": [
              "SHA-256 hash of the SwapDetails"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when commitment was created"
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed for derivation"
            ],
            "type": "u8"
          },
          {
            "name": "amountLamports",
            "docs": [
              "Amount of lamports being staked (for display purposes)"
            ],
            "type": "u64"
          },
          {
            "name": "isStake",
            "docs": [
              "Whether this is a stake (SOL -> slpSOL) or unstake (slpSOL -> SOL)"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "poolConfig",
      "docs": [
        "Main pool configuration account"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Admin who can update pool settings"
            ],
            "type": "pubkey"
          },
          {
            "name": "slpMint",
            "docs": [
              "slpSOL token mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "totalStakedLamports",
            "docs": [
              "Total SOL currently staked with validators"
            ],
            "type": "u64"
          },
          {
            "name": "totalSlpSupply",
            "docs": [
              "Total slpSOL tokens minted (supply)"
            ],
            "type": "u64"
          },
          {
            "name": "reserveLamports",
            "docs": [
              "SOL held in reserve for instant unstakes"
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Protocol fee in basis points (e.g., 100 = 1%)"
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Whether the pool is paused"
            ],
            "type": "bool"
          },
          {
            "name": "lastHarvestEpoch",
            "docs": [
              "Last epoch when rewards were harvested"
            ],
            "type": "u64"
          },
          {
            "name": "validatorCount",
            "docs": [
              "Number of validators in the pool"
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for this PDA"
            ],
            "type": "u8"
          },
          {
            "name": "authorityBump",
            "docs": [
              "Bump seed for pool authority PDA"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "stakeEvent",
      "docs": [
        "Event emitted when a stake is completed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User who staked"
            ],
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "docs": [
              "Amount of SOL staked (in lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "minOut",
            "docs": [
              "Minimum slpSOL expected"
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp of the stake"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "swapDetails",
      "docs": [
        "Swap details that get hashed for the commitment",
        "This struct is serialized and hashed to create the commitment"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountIn",
            "docs": [
              "Amount of input tokens (lamports for SOL, smallest unit for slpSOL)"
            ],
            "type": "u64"
          },
          {
            "name": "minOut",
            "docs": [
              "Minimum output amount (protects against slippage)"
            ],
            "type": "u64"
          },
          {
            "name": "slippageBps",
            "docs": [
              "Slippage tolerance in basis points (e.g., 50 = 0.5%)"
            ],
            "type": "u16"
          },
          {
            "name": "nonce",
            "docs": [
              "Random nonce to prevent replay attacks"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "swapEvent",
      "docs": [
        "Event emitted when an AMM swap is completed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User who swapped"
            ],
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "docs": [
              "Amount in"
            ],
            "type": "u64"
          },
          {
            "name": "minOut",
            "docs": [
              "Minimum out"
            ],
            "type": "u64"
          },
          {
            "name": "aToB",
            "docs": [
              "Direction (true = A to B, false = B to A)"
            ],
            "type": "bool"
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "unstakeEvent",
      "docs": [
        "Event emitted when an unstake is completed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User who unstaked"
            ],
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "docs": [
              "Amount of slpSOL unstaked"
            ],
            "type": "u64"
          },
          {
            "name": "minOut",
            "docs": [
              "Minimum SOL expected"
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Timestamp of the unstake"
            ],
            "type": "i64"
          }
        ]
      }
    }
  ]
};
