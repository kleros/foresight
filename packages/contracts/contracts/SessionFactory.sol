// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISeerMarketFactory} from "./interfaces/ISeerMarketFactory.sol";

/// @title SessionFactory
/// @notice Permissionless orchestrator around Seer's `MarketFactory` to deploy Futarchy sessions.
/// @dev Trusts the Seer `MarketFactory` at `seerMarketFactory`
contract SessionFactory {
  // ************************************* //
  // *         Enums / Structs           * //
  // ************************************* //

  struct Session {
    address deployer; // User who created the atomic session or started the phased deploy. Only the deployer can create subsequent child markets for phased deploys.
    address parentMarket; // Parent market address deployed from seer.
    address[] childMarkets; // Array of child markets conditional on the parent market.
    uint64 openedAt; // Timestamp of session creation.
    uint64 completedAt; // For phased deploys, `completedAt` is 0 until all children exist.
    uint256 expectedChildCount; // Number of children for the session, used to determine the required number of child markets in phased deploy.
    string metadataUri; // IPFS URI of the display metadata document.
  }

  /// @notice Parent categorical market configuration passed to Seer.
  struct ParentCategoricalConfig {
    string marketName; // Human readable market name.
    string[] outcomes; // The market outcomes, doesn't include the INVALID_RESULT outcome.
    string[] tokenNames; // Name of the ERC20 tokens associated to each outcome.
    string category; // Reality question category.
    string lang; // Reality question language.
    uint256 minBond; // Min bond to use on Reality.
    uint32 openingTime; // Reality question opening time.
  }

  /// @notice Scalar child market configuration for one parent outcome branch.
  /// @dev Passed through to Seer `createScalarMarket` (Seer enforces outcome/token shape).
  struct ChildScalarConfig {
    uint256 parentOutcomeIndex; // Parent outcome index this market is conditional on.
    string marketName; // Human readable market name.
    string[] outcomes; // The market outcomes, doesn't include the INVALID_RESULT outcome.
    string[] tokenNames; // Name of the ERC20 tokens associated to each outcome.
    uint256 lowerBound; // Lower bound.
    uint256 upperBound; // Upper bound.
    uint256 minBond; // Min bond to use on Reality.
    uint32 openingTime; // Reality question opening time.
    string category; // Reality question category.
    string lang; // Reality question language.
  }

  /// @notice Atomic or phased session deploy input.
  struct DeploySessionParams {
    ParentCategoricalConfig parent;
    ChildScalarConfig[] children;
    bool multiCategoricalParent; // Defines whether the parent market should be a Categorical or Multi-Categorical market.
    string metadataUri; // IPFS URI of the display metadata document.
  }

  // ************************************* //
  // *             Storage               * //
  // ************************************* //

  /// @notice Seer market factory. TRUSTED.
  ISeerMarketFactory public immutable seerMarketFactory;

  /// @notice Count of sessions.
  uint256 public sessionCount;

  /// @notice Stored session records keyed by session id.
  mapping(uint256 sessionId => Session session) public sessions;

  // ************************************* //
  // *              Events               * //
  // ************************************* //

  /// @notice Emitted when a parent market is created for a session.
  /// @param sessionId ID of the new session.
  /// @param deployer Address of the deployer of this session.
  /// @param parentMarket Address of the parent market of the session.
  /// @param outcomeCount Number of outcomes of the parent categorical or multi-categorical market. Does not count for INVALID outcome.
  /// @param metadataUri IPFS URI of the display metadata document.
  event ParentMarketDeployed(
    uint256 indexed sessionId,
    address indexed deployer,
    address indexed parentMarket,
    uint256 outcomeCount,
    string metadataUri
  );

  /// @notice Emitted when a scalar child market is created for a session.
  /// @param sessionId ID of the session this child market belongs to.
  /// @param parentOutcomeIndex Outcome index in parent market that this child market is conditional on.
  /// @param childMarket Address of the scalar child market.
  /// @param parentMarket Address of the parent market this child market is conditional on.
  event ChildMarketDeployed(
    uint256 indexed sessionId,
    uint256 indexed parentOutcomeIndex,
    address indexed childMarket,
    address parentMarket
  );

  /// @notice Restricts phased child batches to the original session deployer.
  modifier onlySessionDeployer(uint256 sessionId) {
    if (msg.sender != sessions[sessionId].deployer) revert NotSessionDeployer();
    _;
  }

  // ************************************* //
  // *            Constructor            * //
  // ************************************* //

  /// @notice Binds this factory to a Seer `MarketFactory` deployment.
  /// @param _factory Seer market factory.
  /// @dev The factory implementation is TRUSTED.
  constructor(ISeerMarketFactory _factory) {
    seerMarketFactory = _factory;
  }

  // ************************************* //
  // *         State Modifiers           * //
  // ************************************* //

  /// @notice Atomic deploy: parent + all scalar children in one call.
  /// @param params DeploySessionParams instance.
  /// @return sessionId Unique session id for the session.
  /// @return parentAddress Seer parent market address.
  /// @return childMarkets Seer scalar child addresses in parent outcome order.
  /// @dev O(n) in the number of parent outcomes; each outcome triggers one Seer scalar market creation.
  function deploySession(
    DeploySessionParams calldata params
  ) external returns (uint256 sessionId, address parentAddress, address[] memory childMarkets) {
    if (bytes(params.metadataUri).length == 0) revert MissingMetadata();
    _validateChildren(params.parent.outcomes.length, params.children);
    uint256 parentOutcomeCount = params.parent.outcomes.length;

    sessionId = sessionCount++;

    parentAddress = _seerCreateParent(params.parent, params.multiCategoricalParent);

    emit ParentMarketDeployed(sessionId, msg.sender, parentAddress, parentOutcomeCount, params.metadataUri);

    childMarkets = new address[](parentOutcomeCount);
    for (uint256 parentOutcomeIndex = 0; parentOutcomeIndex < parentOutcomeCount; parentOutcomeIndex++) {
      childMarkets[parentOutcomeIndex] = _deployChildScalarForSession(
        params.children[parentOutcomeIndex],
        parentAddress,
        sessionId,
        parentOutcomeIndex
      );
    }

    uint64 timestamp = uint64(block.timestamp);
    sessions[sessionId] = Session({
      deployer: msg.sender,
      parentMarket: parentAddress,
      childMarkets: childMarkets,
      openedAt: timestamp,
      completedAt: timestamp,
      expectedChildCount: parentOutcomeCount,
      metadataUri: params.metadataUri
    });
  }

  /// @notice Phased step 1: deploy parent only. Child configs are supplied per batch in step 2.
  /// @param parent Parent market configuration.
  /// @param multiCategoricalParent When true, uses Seer's multi-categorical market.
  /// @param metadataUri IPFS URI of the display metadata document.
  /// @return sessionId Unique session id for the session.
  /// @return parentAddress Seer parent market address.
  function openPhasedSession(
    ParentCategoricalConfig calldata parent,
    bool multiCategoricalParent,
    string calldata metadataUri
  ) external returns (uint256 sessionId, address parentAddress) {
    if (bytes(metadataUri).length == 0) revert MissingMetadata();

    sessionId = sessionCount++;

    parentAddress = _seerCreateParent(parent, multiCategoricalParent);

    uint256 outcomeCount = parent.outcomes.length;

    emit ParentMarketDeployed(sessionId, msg.sender, parentAddress, outcomeCount, metadataUri);

    sessions[sessionId] = Session({
      deployer: msg.sender,
      parentMarket: parentAddress,
      childMarkets: new address[](0),
      openedAt: uint64(block.timestamp),
      completedAt: 0,
      expectedChildCount: outcomeCount,
      metadataUri: metadataUri
    });
  }

  /// @notice Phased step 2+: append scalar children in strict index order.
  /// @param sessionId Session opened via `openPhasedSession`.
  /// @param childBatch One or more child configs; indices must continue the stored sequence.
  /// @dev O(m) in batch size `m`; each entry triggers one Seer market creation.
  function deploySessionChildBatch(
    uint256 sessionId,
    ChildScalarConfig[] calldata childBatch
  ) external onlySessionDeployer(sessionId) {
    Session storage session = sessions[sessionId];
    if (session.completedAt != 0) revert SessionAlreadyComplete();

    uint256 start = session.childMarkets.length;
    uint256 batchSize = childBatch.length;

    if (batchSize == 0) revert InvalidConfig();
    if (start + batchSize > session.expectedChildCount) revert ChildBatchExceedsExpected();

    address parent = session.parentMarket;
    for (uint256 i = 0; i < batchSize; i++) {
      uint256 globalIndex = start + i;
      ChildScalarConfig calldata childConfig = childBatch[i];

      if (childConfig.parentOutcomeIndex != globalIndex) revert InvalidConfig(); // Invalid ordering of child.

      address childAddress = _deployChildScalarForSession(childConfig, parent, sessionId, globalIndex);
      session.childMarkets.push(childAddress);
    }

    if (session.childMarkets.length == session.expectedChildCount) {
      session.completedAt = uint64(block.timestamp);
    }
  }

  // ************************************* //
  // *           Public Views            * //
  // ************************************* //

  /// @param sessionId Session id.
  /// @return session Session details.
  function getSession(uint256 sessionId) external view returns (Session memory session) {
    session = sessions[sessionId];
  }

  // ************************************* //
  // *            Internal               * //
  // ************************************* //

  /// @notice Validates child count matches parent outcomes and strict index ordering.
  /// @param parentOutcomeCount Count of parent market outcomes.
  /// @param childConfigs Scalar child configuration, one per parent outcome.
  /// @dev O(n) in the number of parent outcomes.
  function _validateChildren(uint256 parentOutcomeCount, ChildScalarConfig[] calldata childConfigs) private pure {
    if (childConfigs.length != parentOutcomeCount) {
      revert InvalidConfig();
    }

    for (uint256 parentOutcomeIndex = 0; parentOutcomeIndex < parentOutcomeCount; parentOutcomeIndex++) {
      if (childConfigs[parentOutcomeIndex].parentOutcomeIndex != parentOutcomeIndex) {
        revert InvalidConfig();
      }
    }
  }

  /// @notice Creates a categorical or multi-categorical parent market via Seer.
  /// @param parentConfig Parent market configuration.
  /// @param multiCategoricalParent When true, uses Seer's multi-categorical factory path.
  /// @return parentAddress Seer parent market address.
  function _seerCreateParent(
    ParentCategoricalConfig calldata parentConfig,
    bool multiCategoricalParent
  ) private returns (address parentAddress) {
    ISeerMarketFactory.CreateMarketParams memory createParams = ISeerMarketFactory.CreateMarketParams({
      marketName: parentConfig.marketName,
      outcomes: parentConfig.outcomes,
      questionStart: "", // omitted since it's only required for multi scalar markets
      questionEnd: "", // omitted since it's only required for multi scalar markets
      outcomeType: "", // omitted since it's only required for multi scalar markets
      parentOutcome: 0, // Parent market is not conditional on any market.
      parentMarket: address(0), // Parent markets are not linked to an existing parent market.
      category: parentConfig.category,
      lang: parentConfig.lang,
      lowerBound: 0, // not applicable for non-scalar markets
      upperBound: 0, // not applicable for non-scalar markets
      minBond: parentConfig.minBond,
      openingTime: parentConfig.openingTime,
      tokenNames: parentConfig.tokenNames
    });

    parentAddress = multiCategoricalParent
      ? seerMarketFactory.createMultiCategoricalMarket(createParams)
      : seerMarketFactory.createCategoricalMarket(createParams);
  }

  /// @notice Creates one scalar child market linked to a parent outcome branch.
  /// @param childConfig Scalar child configuration.
  /// @param parentAddress Parent market address.
  /// @param sessionId Session id this child belongs to.
  /// @param parentOutcomeIndex Parent outcome index.
  /// @return childAddress Seer scalar child address.
  function _deployChildScalarForSession(
    ChildScalarConfig calldata childConfig,
    address parentAddress,
    uint256 sessionId,
    uint256 parentOutcomeIndex
  ) private returns (address childAddress) {
    ISeerMarketFactory.CreateMarketParams memory createParams = ISeerMarketFactory.CreateMarketParams({
      marketName: childConfig.marketName,
      outcomes: childConfig.outcomes,
      questionStart: "", // omitted since it's only required for multi scalar markets
      questionEnd: "", // omitted since it's only required for multi scalar markets
      outcomeType: "", // omitted since it's only required for multi scalar markets
      parentOutcome: childConfig.parentOutcomeIndex,
      parentMarket: parentAddress,
      category: childConfig.category,
      lang: childConfig.lang,
      lowerBound: childConfig.lowerBound,
      upperBound: childConfig.upperBound,
      minBond: childConfig.minBond,
      openingTime: childConfig.openingTime,
      tokenNames: childConfig.tokenNames
    });

    childAddress = seerMarketFactory.createScalarMarket(createParams);

    emit ChildMarketDeployed(sessionId, parentOutcomeIndex, childAddress, parentAddress);
  }

  // ************************************* //
  // *              Errors               * //
  // ************************************* //

  /// @notice Thrown when deploy parameters fail validation checks.
  error InvalidConfig();

  /// @notice Thrown when a phased child batch is sent by an address other than the deployer.
  error NotSessionDeployer();

  /// @notice Thrown when phased child batches are sent after the session is complete.
  error SessionAlreadyComplete();

  /// @notice Thrown when a phased child batch would exceed the expected child count.
  error ChildBatchExceedsExpected();

  /// @notice Thrown when a session is opened without a display metadata URI.
  error MissingMetadata();
}
