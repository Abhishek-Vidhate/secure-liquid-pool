/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stake_pool.json`.
 */
export type StakePool = {
  "address": "EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7",
  "metadata": {
    "name": "stakePool",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "SecureLiquidPool - Liquid Staking Pool with Real Validator Delegation"
  },
  "instructions": [
    {
      "name": "addValidator",
      "docs": [
        "Add a validator to the pool's delegation list"
      ],
      "discriminator": [
        250,
        113,
        53,
        54,
        141,
        117,
        215,
        185
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
          }
        },
        {
          "name": "voteAccount"
        },
        {
          "name": "validatorEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              },
              {
                "kind": "account",
                "path": "voteAccount"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateStake",
      "docs": [
        "Crank: Move SOL from reserve to validators",
        "This is called periodically to actually stake the deposited SOL"
      ],
      "discriminator": [
        50,
        110,
        95,
        179,
        194,
        75,
        140,
        246
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
          }
        },
        {
          "name": "validatorEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "poolConfig"
              },
              {
                "kind": "account",
                "path": "validator_entry.vote_account",
                "account": "validatorEntry"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositSol",
      "docs": [
        "Deposit SOL and receive slpSOL tokens"
      ],
      "discriminator": [
        108,
        81,
        78,
        117,
        125,
        155,
        56,
        200
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
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
            ]
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
            ]
          }
        },
        {
          "name": "slpMint",
          "writable": true
        },
        {
          "name": "userSlpAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "harvestRewards",
      "docs": [
        "Crank: Simulate harvesting epoch rewards",
        "On devnet, we simulate rewards based on ~7% APY"
      ],
      "discriminator": [
        213,
        164,
        27,
        71,
        21,
        69,
        10,
        104
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initializePool",
      "docs": [
        "Initialize the staking pool with slpSOL mint"
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
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
            ]
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
            ]
          }
        },
        {
          "name": "slpMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Admin: Pause/unpause the pool"
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateFee",
      "docs": [
        "Admin: Update fee"
      ],
      "discriminator": [
        232,
        253,
        195,
        247,
        148,
        212,
        73,
        222
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "withdrawSol",
      "docs": [
        "Withdraw SOL by burning slpSOL tokens"
      ],
      "discriminator": [
        145,
        131,
        74,
        136,
        65,
        137,
        42,
        38
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "poolConfig",
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
            ]
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
            ]
          }
        },
        {
          "name": "slpMint",
          "writable": true
        },
        {
          "name": "userSlpAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "slpAmount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
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
    },
    {
      "name": "validatorEntry",
      "discriminator": [
        174,
        87,
        76,
        168,
        228,
        42,
        70,
        4
      ]
    }
  ],
  "events": [
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "poolInitialized",
      "discriminator": [
        100,
        118,
        173,
        87,
        12,
        198,
        254,
        229
      ]
    },
    {
      "name": "rewardsHarvested",
      "discriminator": [
        27,
        248,
        121,
        187,
        166,
        132,
        212,
        89
      ]
    },
    {
      "name": "stakeDelegated",
      "discriminator": [
        126,
        201,
        132,
        208,
        255,
        188,
        95,
        225
      ]
    },
    {
      "name": "validatorAdded",
      "discriminator": [
        67,
        26,
        43,
        25,
        58,
        219,
        99,
        48
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6001,
      "name": "insufficientSol",
      "msg": "Insufficient SOL for deposit"
    },
    {
      "code": 6002,
      "name": "insufficientSlpSol",
      "msg": "Insufficient slpSOL for withdrawal"
    },
    {
      "code": 6003,
      "name": "poolPaused",
      "msg": "Pool is paused"
    },
    {
      "code": 6004,
      "name": "invalidValidator",
      "msg": "Invalid validator vote account"
    },
    {
      "code": 6005,
      "name": "validatorAlreadyExists",
      "msg": "Validator already exists in pool"
    },
    {
      "code": 6006,
      "name": "maxValidatorsReached",
      "msg": "Maximum validators reached"
    },
    {
      "code": 6007,
      "name": "validatorNotFound",
      "msg": "Validator not found in pool"
    },
    {
      "code": 6008,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6009,
      "name": "insufficientReserve",
      "msg": "Insufficient reserve for instant unstake"
    },
    {
      "code": 6010,
      "name": "belowMinimumStake",
      "msg": "Minimum stake amount not met (0.01 SOL)"
    },
    {
      "code": 6011,
      "name": "invalidStakeState",
      "msg": "Invalid stake account state"
    },
    {
      "code": 6012,
      "name": "epochNotChanged",
      "msg": "Epoch has not changed since last harvest"
    },
    {
      "code": 6013,
      "name": "noRewardsToHarvest",
      "msg": "No rewards to harvest"
    },
    {
      "code": 6014,
      "name": "invalidMintAuthority",
      "msg": "Invalid mint authority"
    },
    {
      "code": 6015,
      "name": "reserveRatioExceeded",
      "msg": "Reserve ratio exceeded"
    }
  ],
  "types": [
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "solAmount",
            "type": "u64"
          },
          {
            "name": "slpMinted",
            "type": "u64"
          },
          {
            "name": "exchangeRate",
            "type": "u64"
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
      "name": "poolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "slpMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "rewardsHarvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "grossRewards",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "netRewards",
            "type": "u64"
          },
          {
            "name": "newExchangeRate",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "stakeDelegated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "validatorAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voteAccount",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "validatorEntry",
      "docs": [
        "Validator entry in the pool"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voteAccount",
            "docs": [
              "The validator's vote account"
            ],
            "type": "pubkey"
          },
          {
            "name": "stakeAccount",
            "docs": [
              "The stake account delegated to this validator"
            ],
            "type": "pubkey"
          },
          {
            "name": "stakedLamports",
            "docs": [
              "Amount of lamports staked with this validator"
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateEpoch",
            "docs": [
              "Last epoch this validator's stake was updated"
            ],
            "type": "u64"
          },
          {
            "name": "active",
            "docs": [
              "Whether this validator is active"
            ],
            "type": "bool"
          },
          {
            "name": "stakeBump",
            "docs": [
              "Bump seed for stake account PDA"
            ],
            "type": "u8"
          },
          {
            "name": "index",
            "docs": [
              "Index in validator list"
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
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "solAmount",
            "type": "u64"
          },
          {
            "name": "slpBurned",
            "type": "u64"
          },
          {
            "name": "exchangeRate",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
