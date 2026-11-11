import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import {
  decodeCerebraille,
  encodeCerebraille,
  frontierToolSchemas,
  getCerebrailleCodebook,
  lookupSymbol,
  trainingDescriptor
} from './cerebraille-service.js';

const DomainEnum = new GraphQLEnumType({
  name: 'CerebrailleDomain',
  values: {
    latex: { value: 'latex' },
    prose: { value: 'prose' },
    code: { value: 'code' },
    structured: { value: 'structured' },
    control: { value: 'control' },
    agent_state: { value: 'agent_state' },
    tool_protocol: { value: 'tool_protocol' },
    mixed: { value: 'mixed' }
  }
});

const FidelityModeEnum = new GraphQLEnumType({
  name: 'FidelityMode',
  values: {
    lossless: { value: 'lossless' },
    semantic: { value: 'semantic' }
  }
});

const CategoryEnum = new GraphQLEnumType({
  name: 'CodebookCategory',
  values: {
    latex: { value: 'latex' },
    prose: { value: 'prose' },
    code: { value: 'code' },
    structured: { value: 'structured' },
    control: { value: 'control' }
  }
});

const SymbolType = new GraphQLObjectType({
  name: 'CerebrailleSymbol',
  fields: {
    cell: { type: new GraphQLNonNull(GraphQLString) },
    codepoint: { type: new GraphQLNonNull(GraphQLString) },
    dotPattern: { type: new GraphQLNonNull(GraphQLInt) },
    expansion: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: new GraphQLNonNull(CategoryEnum) },
    version: { type: new GraphQLNonNull(GraphQLString) }
  }
});

const CodecStatsType = new GraphQLObjectType({
  name: 'CodecStats',
  fields: {
    entries: { type: new GraphQLNonNull(GraphQLInt) },
    remainingCells: { type: new GraphQLNonNull(GraphQLInt) },
    latex: { type: GraphQLInt, resolve: parent => parent.byCategory?.latex || 0 },
    prose: { type: GraphQLInt, resolve: parent => parent.byCategory?.prose || 0 },
    code: { type: GraphQLInt, resolve: parent => parent.byCategory?.code || 0 },
    structured: { type: GraphQLInt, resolve: parent => parent.byCategory?.structured || 0 },
    control: { type: GraphQLInt, resolve: parent => parent.byCategory?.control || 0 }
  }
});

const CodebookType = new GraphQLObjectType({
  name: 'CerebrailleCodebook',
  fields: {
    version: { type: new GraphQLNonNull(GraphQLString) },
    symbols: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(SymbolType))) },
    stats: { type: new GraphQLNonNull(CodecStatsType) }
  }
});

const MatchedEntryType = new GraphQLObjectType({
  name: 'MatchedEntry',
  fields: {
    cell: { type: new GraphQLNonNull(GraphQLString) },
    codepoint: { type: new GraphQLNonNull(GraphQLString) },
    expansion: { type: new GraphQLNonNull(GraphQLString) },
    count: { type: new GraphQLNonNull(GraphQLInt) }
  }
});

const EncodeResultType = new GraphQLObjectType({
  name: 'CerebrailleEncodeResult',
  fields: {
    original: { type: new GraphQLNonNull(GraphQLString) },
    encoded: { type: new GraphQLNonNull(GraphQLString) },
    decoded: { type: new GraphQLNonNull(GraphQLString) },
    domain: { type: new GraphQLNonNull(DomainEnum) },
    fidelityMode: { type: new GraphQLNonNull(FidelityModeEnum) },
    originalChars: { type: new GraphQLNonNull(GraphQLInt) },
    encodedCells: { type: new GraphQLNonNull(GraphQLInt) },
    compressionRatio: { type: new GraphQLNonNull(GraphQLFloat) },
    exactRoundtrip: { type: new GraphQLNonNull(GraphQLBoolean) },
    matchedEntries: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(MatchedEntryType))) },
    codebookVersion: { type: new GraphQLNonNull(GraphQLString) }
  }
});

const DecodeResultType = new GraphQLObjectType({
  name: 'CerebrailleDecodeResult',
  fields: {
    encoded: { type: new GraphQLNonNull(GraphQLString) },
    decoded: { type: new GraphQLNonNull(GraphQLString) },
    encodedCells: { type: new GraphQLNonNull(GraphQLInt) },
    codebookVersion: { type: new GraphQLNonNull(GraphQLString) }
  }
});

const TrainingDescriptorType = new GraphQLObjectType({
  name: 'CerebrailleTrainingDescriptor',
  fields: {
    backend: { type: new GraphQLNonNull(GraphQLString) },
    sequenceShape: { type: new GraphQLNonNull(GraphQLString) },
    vocabularySize: { type: new GraphQLNonNull(GraphQLInt) },
    objective: { type: new GraphQLNonNull(GraphQLString) },
    inputs: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    outputs: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    losses: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) }
  }
});

const ToolSchemaType = new GraphQLObjectType({
  name: 'FrontierToolSchema',
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
    inputSchemaJson: { type: new GraphQLNonNull(GraphQLString), resolve: parent => JSON.stringify(parent.input_schema) }
  }
});

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    codebook: {
      type: new GraphQLNonNull(CodebookType),
      args: { domain: { type: DomainEnum } },
      resolve: (_parent, args) => getCerebrailleCodebook(args.domain)
    },
    symbol: {
      type: SymbolType,
      args: {
        cell: { type: GraphQLString },
        codepoint: { type: GraphQLString }
      },
      resolve: (_parent, args) => lookupSymbol(args)
    },
    decode: {
      type: new GraphQLNonNull(DecodeResultType),
      args: { encoded: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: (_parent, args) => decodeCerebraille({ encoded: args.encoded })
    },
    trainingDescriptor: {
      type: new GraphQLNonNull(TrainingDescriptorType),
      resolve: () => trainingDescriptor()
    },
    frontierTools: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ToolSchemaType))),
      resolve: () => frontierToolSchemas()
    }
  }
});

const MutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    encode: {
      type: new GraphQLNonNull(EncodeResultType),
      args: {
        text: { type: new GraphQLNonNull(GraphQLString) },
        domain: { type: DomainEnum },
        fidelityMode: { type: FidelityModeEnum }
      },
      resolve: (_parent, args) => encodeCerebraille({ text: args.text, domain: args.domain, fidelityMode: args.fidelityMode })
    }
  }
});

export const cerebrailleSchema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType
});
