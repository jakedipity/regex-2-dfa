const finiteAutomata = require('finite-automata');

/*
 * Start            : Alternation TOKEN_END
 *                  ;
 *
 * Alternation      : Concatenation
 *                  : Concatenation TOKEN_PIPE Alternation
 *                  ;
 *
 * Concatenation    : Quantifier
 *                  : Quantifier Concatenation
 *                  ;
 *
 * Quantifier       : Term
 *                  : Term TOKEN_QUESTION_MARK
 *                  : Term TOKEN_STAR
 *                  : Term TOKEN_PLUS
 *                  : Term TOKEN_OPEN_CURLY MatchOptions TOKEN_CLOSE_CURLY
 *                  ;
 *
 * Term             : TOKEN_CHAR
 *                  : TOKEN_CHAR Term
 *                  : TOKEN_OPEN_PAREN Alternation TOKEN_CLOSE_PAREN
 *                  ;
 *
 * MatchOptions     : TOKEN_NUMBER
 *                  : TOKEN_NUMBER TOKEN_COMMA
 *                  : TOKEN_NUMBER TOKEN_COMMA TOKEN_NUMBER
 *                  ;
 */

class ParseContext {
    constructor(input, finiteAutomata) {
        this._input = input;
        this._pos = 0;
        this._lastAccepted = null;
        this._finiteAutomata = finiteAutomata;
    }

    acceptEnd() {
        if (this._pos === this._input.length) {
            this._lastAccepted = null;
            return true;
        }

        return false;
    }

    acceptToken(token) {
        if (this._pos === this._input.length) {
            return false;
        }

        if (this._input[this._pos] === token) {
            this._lastAccepted = token;
            ++this._pos;
            return true;
        }

        return false;
    }

    acceptChar() {
        if (this._pos === this._input.length) {
            return false;
        }

        const char = this._input[this._pos];
        if (char === '|' || char === '(' || char === ')' || char === '?' || char === '*' || char === '+') {
            return false;
        }

        this._lastAccepted = char;
        ++this._pos;
        return true;
    }

    acceptRegex(regex) {
        if (this._pos === this._input.length) {
            return false;
        }

        regex.lastIndex = this._pos;
        let matchData = regex.exec(this._input);
        if (matchData !== null && matchData.index === this._pos) {
            this._lastAccepted = matchData[0];
            this._pos += matchData[0].length;
            return true;
        }

        return false;
    }

    peekChar() {
        if (this._pos === this._input.length) {
            return [null, null];
        }

        return [this._input[this._pos], this._pos];
    }

    getLastAccepted() {
        return this._lastAccepted;
    }

    getFiniteAutomata() {
        return this._finiteAutomata;
    }
}

const ERROR_TYPE = {
    UNEXPECTED_CHARACTER: 0
};

const _buildError = (errorType, parseContext) => {
    if (errorType === ERROR_TYPE.UNEXPECTED_CHARACTER) {
        const [peekChar, peekPos] = parseContext.peekChar();
        return `Unexpected character ${peekChar} at position ${peekPos}`;
    }
};

let _grammarStart, _grammarAlternation, _grammarConcatenation, _grammarQuantifier, _grammarTerm;
let _peekStart, _peekAlternation, _peekConcatenation, _peekQuantifier, _peekTerm;

_grammarStart = (parseContext) => {
    const [err, rootState, acceptingState] = _grammarAlternation(parseContext);

    if (err) {
        return [err];
    }

    if (!parseContext.acceptEnd()) {
        console.log('Building error');
        return [_buildError(ERROR_TYPE.UNEXPECTED_CHARACTER, parseContext)];
    }

    return [null, rootState, acceptingState];
};

_peekStart = (parseContext) => {
    return _peekAlternation();
};

_grammarAlternation = (parseContext) => {
    let [err, rootState, acceptingState] = _grammarConcatenation(parseContext);

    if (err) {
        return [err];
    }

    let alternations = [[rootState, acceptingState]];

    while (parseContext.acceptToken('|')) {
        [err, rootState, acceptingState] = _grammarConcatenation(parseContext);

        if (err) {
            return [err];
        }

        alternations.push([rootState, acceptingState]);
    }

    if (alternations.length === 1) {
        return [null, rootState, acceptingState];
    }

    const newRootState = new finiteAutomata.FiniteAutomataState({ finiteAutomata: parseContext.getFiniteAutomata() });
    const newAcceptingState = new finiteAutomata.FiniteAutomataState({ finiteAutomata: parseContext.getFiniteAutomata() });

    for (const alternation of alternations) {
        newRootState.addEpsilonTransition(alternation[0]);
        alternation[1].addEpsilonTransition(newAcceptingState);
    }

    return [null, newRootState, newAcceptingState];
};

_peekAlternation = (parseContext) => {
    return _peekConcatenation(parseContext);
};

_grammarConcatenation = (parseContext) => {
    let [err, rootState, acceptingState] = _grammarQuantifier(parseContext);

    if (err) {
        return [err];
    }

    let concatenations = [[rootState, acceptingState]];

    while (_peekConcatenation(parseContext)) {
        [err, rootState, acceptingState] = _grammarQuantifier(parseContext);

        if (err) {
            return [err];
        }

        concatenations.push([rootState, acceptingState]);
    }

    if (concatenations.length === 1) {
        return [null, rootState, acceptingState];
    }

    let middleState = concatenations[0][1];
    for (let i = 1; i < concatenations.length; ++i) {
        const concatenation = concatenations[i];
        middleState.addEpsilonTransition(concatenation[0]);
        middleState = concatenation[1];
    }

    return [null, concatenations[0][0], middleState];
};

_peekConcatenation = (parseContext) => {
    return _peekQuantifier(parseContext);
};

_grammarQuantifier = (parseContext) => {
    const [err, rootState, acceptingState] = _grammarTerm(parseContext);

    if (err) {
        return [err];
    }

    if (parseContext.acceptToken('?')) {
        rootState.addEpsilonTransition(acceptingState);
    } else if (parseContext.acceptToken('*')) {
        rootState.addEpsilonTransition(acceptingState);
        acceptingState.addEpsilonTransition(rootState);
    } else if (parseContext.acceptToken('+')) {
        acceptingState.addEpsilonTransition(rootState);
    }

    return [null, rootState, acceptingState];
};

_peekQuantifier = (parseContext) => {
    return _peekTerm(parseContext);
};

_grammarTerm = (parseContext) => {
    if (parseContext.acceptChar()) {
        let chars = [parseContext.getLastAccepted()];

        while (parseContext.acceptChar()) {
            chars.push(parseContext.getLastAccepted());
        }

        const newRootState = new finiteAutomata.FiniteAutomataState({ finiteAutomata: parseContext.getFiniteAutomata() });
        let newAcceptingState = newRootState;

        for (const char of chars) {
            const middleState = new finiteAutomata.FiniteAutomataState({ finiteAutomata: parseContext.getFiniteAutomata() });

            newAcceptingState.addTransition(char, middleState);
            newAcceptingState = middleState;
        }

        return [null, newRootState, newAcceptingState];
    } else if (parseContext.acceptToken('(')) {
        const [err, rootState, acceptingState] = _grammarAlternation(parseContext);

        if (err) {
            return [err];
        }

        if (!parseContext.acceptToken(')')) {
            return [_buildError(ERROR_TYPE.UNEXPECTED_CHARACTER, parseContext)];
        }

        return [null, rootState, acceptingState];
    } else {
        return [_buildError(ERROR_TYPE.UNEXPECTED_CHARACTER, parseContext)];
    }
};

_peekTerm = (parseContext) => {
    let char = parseContext.peekChar()[0];
    return (char !== null && char !== '|' && char !== ')' && char !== '?' && char !== '*' && char !== '+');
};

const parse = (input) => {
    let parsedFiniteAutomata = new finiteAutomata.FiniteAutomata;
    const parseContext = new ParseContext(input, parsedFiniteAutomata);

    const [err, rootState, acceptingState] = _grammarStart(parseContext);

    if (err) {
        console.log(err);
        return null;
    }

    parsedFiniteAutomata.setRootState(rootState);
    parsedFiniteAutomata.prettyPrint();
    return parsedFiniteAutomata;
};

parse('(ab)*');
