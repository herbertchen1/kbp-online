#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A scoring script.
"""
import os
import csv
import sys
import logging
from collections import defaultdict

import numpy as np

import ipdb
from tqdm import tqdm
from .util import EvaluationEntry, OutputEntry, micro, macro, bootstrap, confidence_intervals

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

def k(entry):
    return (entry.relation_provenances[0], entry.slot_value) # A cheap way to also correct for linking errors.

def kn(entry):
    return (entry.slot_value) # A cheap way to also correct for linking errors.

def load_queries(fstream):
    Q = {}
    for line in fstream:
        fields = line.split()
        # NOTE: We are considering partial assessments because that's
        # what KBP is doing too.
        ldc_query, cssf_query = fields[:2]
        Q[cssf_query] = ldc_query
    return Q

def load_gold(fstream, Q):
    gold = []
    for line in tqdm(fstream):
        entry = EvaluationEntry.from_line(line)
        if entry.query_id in Q:
            gold.append(entry)
    logger.info("Loaded %d evaluation entries", len(gold))
    return gold

def load_output(fstream, Q):
    output = []
    for line in tqdm(fstream):
        entry = OutputEntry.from_line(line)
        if entry.query_id in Q:
            output.append(entry)
    logger.info("Loaded %d output entries.", len(output))
    return output

def compute_entity_scores(gold, output, Q, key=k):
    """
    @gold is a dictionary of {s: F*_s}.
    F*_s = {f: [m]}

    @pred is dictionary of {s: F_s}.
    F_s = {f: [m]}

    @returns (P, R, F1):
        P = {s: P_s}; P_s = F_s ^ F*_s / F_s
        R = {s: R_s}; R_s = F_s ^ F*_s / F*_s
        F1 = {s: F1_s}; F1_s = 2 P_s R_s / (P_s + R_s)
    """
    G = defaultdict(lambda: defaultdict(set)) # Gold data
    Gr = {} # maps from entry to (s, f)
    for entry in gold:
        s = Q[entry.query_id]
        # Considering inexact queries as correct because these are
        # considered correct as per recall computations.
        f = entry.eq # if (entry.slot_value_label == "C") else 0
        G[s][f].add(key(entry)) # Make a key out of this entry.
        Gr[s, key(entry)] = f

    O = defaultdict(lambda: defaultdict(set)) # Gold data
    for entry in output:
        s = Q[entry.query_id]
        f = Gr.get((s, key(entry)), 0)
        O[s][f].add(key(entry))

    S, C, T = {}, {}, {} # submitted, correct, total
    for s, Fs in G.items():
        Fs_ = O[s]

        # In the KBP evaluation, we know that only one mention has been
        # returned per purported entity -- thus, if mentions > 1 =>
        # there are duplicate mentions
        S[s] = sum(len(ms) for f, ms in Fs_.items()) #
        # S[s] = sum(1. if f > 0 else len(ms) for f, ms in Fs_.items())
        # What we'd use otherwise.
        C[s] = sum(1. for f in Fs if f > 0 and f in Fs_)
        T[s] = sum(1. for f in Fs if f > 0)

    return S, C, T

def compute_mention_scores(gold, output, key=k):
    """
    @gold is a dictionary of {s: F*_s}.
    F*_s = {f: [m]}

    @pred is dictionary of {s: F_s}.
    F_s = {f: [m]}

    @returns (P, R, F1):
        P = {s: P_s}; P_s = F_s ^ F*_s / F_s
        R = {s: R_s}; R_s = F_s ^ F*_s / F*_s
        F1 = {s: F1_s}; F1_s = 2 P_s R_s / (P_s + R_s)
    """
    G = defaultdict(set) # Gold data
    for entry in gold:
        if entry.eq > 0: # it's correct!
            G[entry.relation_provenances[0].doc_id].add(key(entry))

    O = defaultdict(set) # output data
    for entry in output:
        O[entry.relation_provenances[0].doc_id].add(key(entry))

    S, C, T = {}, {}, {} # submitted, correct, total
    for d, Fd in G.items():
        Fd_ = O[d]

        S[d] = len(Fd_)
        C[d] = len(Fd.intersection(Fd_))
        T[d] = len(Fd)

    return S, C, T

def do_entity_evaluation(args):
    Q = load_queries(args.queries)
    gold = load_gold(args.gold, Q)
    output = load_output(args.pred, Q)

    S, C, T = compute_entity_scores(gold, output, Q)

    for s in sorted(S):
        args.output.write("{} {:.04f} {:.04f} {:.04f}\n".format(s, *micro({s:S[s]}, {s:C[s]}, {s:T[s]})))
    args.output.write("micro {:.04f} {:.04f} {:.04f}\n".format(*micro(S,C,T)))
    args.output.write("macro {:.04f} {:.04f} {:.04f}\n".format(*macro(S,C,T)))

def do_mention_evaluation(args):
    Q = load_queries(args.queries)
    gold = load_gold(args.gold, Q)
    output = load_output(args.pred, Q)

    S, C, T = compute_mention_scores(gold, output)

    for s in sorted(S):
        args.output.write("{} {:.04f} {:.04f} {:.04f}\n".format(s, *micro({s:S[s]}, {s:C[s]}, {s:T[s]})))
    args.output.write("micro {:.04f} {:.04f} {:.04f}\n".format(*micro(S,C,T)))
    args.output.write("macro {:.04f} {:.04f} {:.04f}\n".format(*macro(S,C,T)))

def compute_score_matrix(scores, E):
    X_rs = np.zeros((len(scores), len(E)))
    for i, runid in enumerate(sorted(scores)):
        S, C, T = scores[runid]
        for j, s in enumerate(sorted(S)):
            X_rs[i, j] = micro({s: S[s]}, {s: C[s]}, {s: T[s]})[-1]
    return X_rs

def measure_variance(X_st):
    """
    Measure the variance in the scores of X_rs
    """
    S, T = X_st.shape
    mu = X_st.mean()
    v_s = X_st.mean(1) - mu # average over columns
    v_t = X_st.mean(0) - mu # average over rows
    v_st = X_st - np.tile(v_s.reshape(S,1), (1, T)) - np.tile(v_t.reshape(1,T), (S, 1)) - mu

    s_s = v_s.var()
    s_t = v_t.var()
    s_st = v_st.var()

    assert abs(X_st.var() - (s_s + s_t + s_st)) < 1e-5

    phi = s_s/(s_s + s_t + s_st)
    rho = s_s/(s_s + s_st)

    return X_st.var(), s_s, s_t, s_st, phi, rho

def report_score_matrix(X_st, out, S, T):
    out.write("\t".join(["s", "s_s", "s_t", "s_st", "phi", "rho"]) + "\n")
    out.write("\t".join(map(str, measure_variance(X_st))) + "\n")

    # Actually print X_st

    out.write("\t" + "\t".join(sorted(T)) + "\n")
    for s, X_s in zip(sorted(S), X_st):
        out.write(s + "\t" + "\t".join(map("{:.4f}".format, X_s)) + "\n")

def standardize_scores(X_st):
    """
    Do a bias, variance correction on the t dimension
    """
    S = X_st.std(0)

    if abs(sum(X_st.mean(0)[S==0.])) > 1e-5:
        logger.warning("X_st matrix had some topic rows with identical scores")

    S[S == 0] = 1. #
    return ((X_st - X_st.mean(0))/S).mean(1)

def do_experiment1(args):
    assert os.path.exists(args.preds) and os.path.isdir(args.preds), "{} does not exist or is not a directory".format(args.preds)

    Q = load_queries(args.queries)
    E = sorted(set(Q.values()))

    gold = load_gold(args.gold, Q)

    writer = csv.writer(args.output, delimiter="\t")
    writer.writerow([
        "system",
        "micro-p", "micro-p-left", "micro-p-right",
        "micro-r", "micro-r-left", "micro-r-right",
        "micro-f1", "micro-f1-left", "micro-f1-right",
        "macro-p", "macro-p-left", "macro-p-right",
        "macro-r", "macro-r-left", "macro-r-right",
        "macro-f1", "macro-f1-left", "macro-f1-right",
        ])

    for fname in os.listdir(args.preds):
        if not fname.endswith(".txt"): continue
        runid = fname.split(".")[0]
        logger.info("Loading output for %s", runid)

        with open(os.path.join(args.preds, fname)) as f:
            output = load_output(f, Q)
            S, C, T = compute_entity_scores(gold, output, Q)

            def compute_metric(E_):
                S_, C_, T_ = {}, {}, {}
                for i, e in enumerate(E_):
                    S_[i], C_[i], T_[i] = S[e], C[e], T[e]
                return micro(S_, C_, T_) + macro(S_, C_, T_)

            # compute bootstrap
            stats = confidence_intervals(E, compute_metric, args.samples, args.confidence)
            writer.writerow([runid, *list(stats.T.flatten())])

def teamid(runid):
    """
    SF_UMass_IESL1 -> UMass_IESL
    """
    return runid.split("_", 1)[-1][:-1]

def do_pooling_bias(args):
    assert os.path.exists(args.preds) and os.path.isdir(args.preds), "{} does not exist or is not a directory".format(args.preds)

    Q = load_queries(args.queries)
    E = sorted(set(Q.values()))

    gold = load_gold(args.gold, Q)
    outputs = {}

    for fname in os.listdir(args.preds):
        if not fname.endswith(".txt"): continue
        runid = fname.split(".")[0]
        logger.info("Loading output for %s", runid)

        with open(os.path.join(args.preds, fname)) as f:
            outputs[runid] = load_output(f, Q)

    def make_loo_pool(gold, outputs, runid, key=k):
        """
        Create a new gold set which includes only the inputs from all other systems.
        """
        valid_entries = set([])
        for runid_, output in outputs.items():
            if runid == runid_: continue
            valid_entries.update(key(entry) for entry in output)
        gold_ = [entry for entry in gold if key(entry) in valid_entries]
        logger.info("loo pool for %s contains %d entries", runid, len(gold_))
        return gold_

    def make_lto_pool(gold, outputs, runid, key=k):
        """
        Create a new gold set which includes only the inputs from all other systems.
        """
        valid_entries = set([])
        for runid_, output in outputs.items():
            if teamid(runid) == teamid(runid_): continue
            valid_entries.update(key(entry) for entry in output)
        gold_ = [entry for entry in gold if key(entry) in valid_entries]
        logger.info("lto pool for %s contains %d entries", runid, len(gold_))
        return gold_

    writer = csv.writer(args.output, delimiter="\t")
    writer.writerow([
        "system",
        "micro-p", "micro-r", "micro-f1", "macro-p", "macro-r", "macro-f1",
        "micro-p-loo", "micro-r-loo", "micro-f1-loo", "macro-p-loo", "macro-r-loo", "macro-f1-loo",
        "micro-p-lto", "micro-r-lto", "micro-f1-lto", "macro-p-lto", "macro-r-lto", "macro-f1-lto",
        "micro-nd-p", "micro-nd-r", "micro-nd-f1", "macro-nd-p", "macro-nd-r", "macro-nd-f1",
        "micro-nd-p-loo", "micro-nd-r-loo", "micro-nd-f1-loo", "macro-nd-p-loo", "macro-nd-r-loo", "macro-nd-f1-loo",
        "micro-nd-p-lto", "micro-nd-r-lto", "micro-nd-f1-lto", "macro-nd-p-lto", "macro-nd-r-lto", "macro-nd-f1-lto",
        ])

    for runid, output in tqdm(outputs.items()):
        row = []
        S, C, T = compute_entity_scores(gold, output, Q)
        row += micro(S, C, T) + macro(S,C,T)

        S, C, T = compute_entity_scores(make_loo_pool(gold, outputs, runid), output, Q)
        row += micro(S, C, T) + macro(S,C,T)

        S, C, T = compute_entity_scores(make_lto_pool(gold, outputs, runid), output, Q)
        row += micro(S, C, T) + macro(S,C,T)

        S, C, T = compute_entity_scores(gold, output, Q, kn)
        row += micro(S, C, T) + macro(S,C,T)

        S, C, T = compute_entity_scores(make_loo_pool(gold, outputs, runid, kn), output, Q, kn)
        row += micro(S, C, T) + macro(S,C,T)

        S, C, T = compute_entity_scores(make_lto_pool(gold, outputs, runid, kn), output, Q, kn)
        row += micro(S, C, T) + macro(S,C,T)

        writer.writerow([runid,] + row)

def do_experiment3(args):
    assert os.path.exists(args.preds) and os.path.isdir(args.preds), "{} does not exist or is not a directory".format(args.preds)

    Q = load_queries(args.queries)
    E = sorted(set(Q.values()))

    gold = load_gold(args.gold, Q)
    scores = {}

    for fname in os.listdir(args.preds):
        if not fname.endswith(".txt"): continue
        runid = fname.split(".")[0]
        logger.info("Loading output for %s", runid)

        if runid == "LDC": continue

        with open(os.path.join(args.preds, fname)) as f:
            output = load_output(f, Q)
            scores[runid] = compute_entity_scores(gold, output, Q)

    X_rs = compute_score_matrix(scores, E)
    report_score_matrix(X_rs, args.output_vis, sorted(scores), sorted(Q))

    writer = csv.writer(args.output, delimiter="\t")
    writer.writerow([
        "system",
        "macro-sf1", "macro-sf1-left", "macro-sf1-right",
        ])

    def compute_metric(E_):
        scores_ = {}
        for runid in scores:
            S, C, T = scores[runid]
            S_, C_, T_ = {}, {}, {}
            for i, e in enumerate(E_):
                S_[i], C_[i], T_[i] = S[e], C[e], T[e]
            scores_[runid] = S_, C_, T_
        X_rs = compute_score_matrix(scores_, E_)
        ys = standardize_scores(X_rs)
        return ys

    # compute bootstrap
    stats = confidence_intervals(E, compute_metric, args.samples, args.confidence)
    logger.info("stats: %d, %d", *stats.shape)
    stats = stats.T
    for i, runid in enumerate(sorted(scores)):
        writer.writerow([runid, *list(stats[i])])

if __name__ == "__main__":
    DD = "data/KBP2015_Cold_Start_Slot-Filling_Evaluation_Results_2016-03-31"
    import argparse
    parser = argparse.ArgumentParser(description='')
    parser.add_argument('-g', '--gold', type=argparse.FileType('r'), default=(DD + "/SF_aux_files/batch_00_05_poolc.assessed.fqec"), help="A list of gold entries")
    parser.add_argument('-q', '--queries', type=argparse.FileType('r'), default=(DD + "/SF_aux_files/batch_00_05_queryids.v3.0.man-cmp.txt"), help="A list of queries that were evaluated")

    subparsers = parser.add_subparsers()
    command_parser = subparsers.add_parser('entity-evaluation', help='Evaluate a single entry (entity)')
    command_parser.add_argument('-p', '--pred', type=argparse.FileType('r'), required=True, help="A list of predicted entries")
    command_parser.add_argument('-o', '--output', type=argparse.FileType('w'), default=sys.stdout, help="Where to write output.")
    command_parser.set_defaults(func=do_entity_evaluation)

    command_parser = subparsers.add_parser('mention-evaluation', help='Evaluate a single entry (mention)')
    command_parser.add_argument('-p', '--pred', type=argparse.FileType('r'), required=True, help="A list of predicted entries")
    command_parser.add_argument('-o', '--output', type=argparse.FileType('w'), default=sys.stdout, help="Where to write output.")
    command_parser.set_defaults(func=do_mention_evaluation)

    command_parser = subparsers.add_parser('experiment1', help='Evaluate P/R/F1 (entity) scores for every entity with 95% confidence thresholds')
    command_parser.add_argument('-ps', '--preds', type=str, default=(DD+ "/corrected_runs/"), help="A directory with predicted entries")
    command_parser.add_argument('-c', '--confidence', type=float, default=.95, help="Confidence threshold")
    command_parser.add_argument('-s', '--samples', type=int, default=5000, help="Confidence threshold")
    command_parser.add_argument('-o', '--output', type=argparse.FileType('w'), default=sys.stdout, help="Where to write output.")
    command_parser.set_defaults(func=do_experiment1)

    command_parser = subparsers.add_parser('pooling-bias', help='Evaluate pooling bias')
    command_parser.add_argument('-ps', '--preds', type=str, default=(DD+ "/corrected_runs/"), help="A directory with predicted entries")
    command_parser.add_argument('-o', '--output', type=argparse.FileType('w'), default=sys.stdout, help="Where to write output.")
    command_parser.set_defaults(func=do_pooling_bias)

    command_parser = subparsers.add_parser('experiment3', help='Evaluate standardized micro/macro F1 (entity) scores for every entity with 95% confidence thresholds')
    command_parser.add_argument('-ps', '--preds', type=str, default=(DD+ "/corrected_runs/"), help="A directory with predicted entries")
    command_parser.add_argument('-c', '--confidence', type=float, default=.95, help="Confidence threshold")
    command_parser.add_argument('-s', '--samples', type=int, default=5000, help="Confidence threshold")
    command_parser.add_argument('-o', '--output', type=argparse.FileType('w'), default=sys.stdout, help="Where to write output.")
    command_parser.add_argument('-ov', '--output-vis', type=argparse.FileType('w'), default="vis.tsv", help="Where to write visualization output.")
    command_parser.set_defaults(func=do_experiment3)

    # TODO: measurement of pairwise significance and diagrams.

    ARGS = parser.parse_args()
    if ARGS.func:
        ARGS.func(ARGS)
    else:
        parser.print_help()
        sys.exit(1)
